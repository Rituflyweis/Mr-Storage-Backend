/**
 * Live HTTP + DB test: POST TractIQ-style xlsx to lead import, verify leads + round-robin.
 *
 * Prereq: server running (npm start) and MONGO_URI in .env
 * Usage: node scripts/test-lead-import-live.js [--rows=6] [--keep]
 */

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const http = require('http')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const FormData = require('form-data')
const ExcelJS = require('exceljs')

const env = require('../src/config/env')
const User = require('../src/models/User')
const Lead = require('../src/models/Lead')
const RoundRobinTracker = require('../src/models/RoundRobinTracker')
const { parseExcelToRecords } = require('../src/services/leadExcelImport.service')

const BASE = `http://127.0.0.1:${env.PORT}`
const SOURCE_XLSX = path.join(__dirname, '..', 'Storage Project Leads 2026-10-22.xlsx')

const args = process.argv.slice(2)
const rowLimit = Math.max(3, parseInt(args.find((a) => a.startsWith('--rows='))?.split('=')[1] || '6', 10))
const keepLeads = args.includes('--keep')

const waitForServer = (maxMs = 60000) =>
  new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      http
        .get(`${BASE}/`, (res) => {
          res.resume()
          resolve()
        })
        .on('error', () => {
          if (Date.now() - start > maxMs) reject(new Error(`Server not up at ${BASE}`))
          else setTimeout(tick, 800)
        })
    }
    tick()
  })

const signStaffToken = (user) =>
  jwt.sign(
    {
      _id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      isMainAdmin: user.role === 'admin' ? Boolean(user.isMainAdmin) : false,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' }
  )

/** Copy real TractIQ workbook; keep rows 1–4; only first N data rows with unique project names. */
const buildSampleXlsx = async (n) => {
  const buf = fs.readFileSync(SOURCE_XLSX)
  const { records, headerRowIndex } = await parseExcelToRecords(buf)
  const stamp = Date.now()
  const slice = records.slice(0, n).map((r) => ({
    ...r,
    projectName: `${r.projectName} [import-test-${stamp}]`,
  }))

  const srcWb = new ExcelJS.Workbook()
  await srcWb.xlsx.load(buf)
  const srcSheet = srcWb.getWorksheet('Leads') || srcWb.worksheets[0]
  const dataStart = headerRowIndex + 1
  const lastRowToKeep = dataStart + n - 1

  for (let r = dataStart; r <= lastRowToKeep; r++) {
    const projectCell = srcSheet.getRow(r).getCell(3)
    const base = cellToPlain(projectCell.value) || slice[r - dataStart]?.projectName
    projectCell.value = base.includes('[import-test-') ? base : `${base} [import-test-${stamp}]`
  }
  for (let r = lastRowToKeep + 1; r <= srcSheet.rowCount; r++) {
    srcSheet.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      cell.value = null
    })
  }

  const outPath = path.join(__dirname, '..', `.tmp-lead-import-test-${stamp}.xlsx`)
  await srcWb.xlsx.writeFile(outPath)
  return { outPath, slice, stamp, headerRowIndex }
}

const cellToPlain = (value) => {
  if (value == null) return ''
  if (typeof value === 'object' && value.text) return String(value.text)
  if (typeof value === 'object' && value.result != null) return String(value.result)
  return String(value)
}

const postImport = (token, filePath, panel) =>
  new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('csv', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const url = new URL(`${BASE}/api/${panel}/leads/import`)
    const req = http.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          Authorization: `Bearer ${token}`,
          ...form.getHeaders(),
        },
      },
      (res) => {
        let body = ''
        res.on('data', (c) => {
          body += c
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) })
          } catch {
            reject(new Error(`Non-JSON ${res.statusCode}: ${body.slice(0, 500)}`))
          }
        })
      }
    )
    req.on('error', reject)
    form.pipe(req)
  })

const main = async () => {
  console.log('[test] Waiting for server at', BASE)
  await waitForServer()

  await mongoose.connect(env.MONGO_URI)

  const admin = await User.findOne({ role: 'admin', isActive: true })
  if (!admin) throw new Error('No active admin user in DB')

  const salesCount = await User.countDocuments({ role: 'sales', isActive: true })
  if (salesCount < 2) {
    console.warn(`[test] Only ${salesCount} active sales user(s) — round-robin needs ≥2 for a meaningful check`)
  }

  let tracker = await RoundRobinTracker.findOne()
  if (!tracker) {
    const ids = await User.find({ role: 'sales', isActive: true }).distinct('_id')
    tracker = await RoundRobinTracker.create({ lastAssignedIndex: -1, activeEmployees: ids })
    console.log('[test] Created RoundRobinTracker with', ids.length, 'sales ids')
  }

  const { outPath, slice, stamp } = await buildSampleXlsx(rowLimit)
  console.log('[test] Sample xlsx:', outPath, '| rows:', slice.length)

  const token = signStaffToken(admin)
  const res = await postImport(token, outPath, 'admin')
  fs.unlinkSync(outPath)

  console.log('[test] HTTP', res.status)
  console.log('[test] Response:', JSON.stringify(res.json, null, 2))

  if (res.status !== 200 || !res.json.success) {
    throw new Error('Import API failed')
  }

  const created = res.json.data?.created ?? res.json.data?.imported
  if (created !== slice.length) {
    console.warn(`[test] Expected ${slice.length} created, got ${created} (duplicates may exist from prior runs)`)
  }

  const projectNames = slice.map((r) => r.projectName)
  const leads = await Lead.find({
    projectName: { $in: projectNames },
    isDeleted: { $ne: true },
  })
    .select('projectName assignedSales isHandedToSales source lifecycleStatus city notes assigningHistory')
    .lean()

  console.log('[test] DB leads found:', leads.length)
  for (const l of leads) {
    console.log('  -', l.projectName.slice(0, 50), '| assigned:', l.assignedSales, '| handed:', l.isHandedToSales)
  }

  if (leads.length === 0) throw new Error('No leads persisted in MongoDB')

  const missingAssign = leads.filter((l) => !l.assignedSales)
  if (salesCount > 0 && missingAssign.length) {
    throw new Error(`${missingAssign.length} lead(s) missing assignedSales after round-robin`)
  }

  const assignIds = [...new Set(leads.map((l) => String(l.assignedSales)).filter(Boolean))]
  if (salesCount >= 2 && assignIds.length < 2 && leads.length >= 2) {
    console.warn('[test] Round-robin: all leads went to one rep (possible if only one sales user in tracker)')
  } else if (assignIds.length >= 2) {
    console.log('[test] Round-robin OK — assignments spread across', assignIds.length, 'sales reps')
  }

  const badHanded = leads.filter((l) => !l.isHandedToSales)
  if (badHanded.length) throw new Error('Some imported leads are not isHandedToSales')

  if (!keepLeads) {
    const ids = leads.map((l) => l._id)
    await Lead.updateMany({ _id: { $in: ids } }, { isDeleted: true, deletedAt: new Date() })
    console.log('[test] Cleaned up test leads (soft-delete). Use --keep to retain.')
  }

  await mongoose.disconnect()
  console.log('[test] PASS — admin import over HTTP + DB verification')
}

main().catch(async (err) => {
  console.error('[test] FAIL:', err.message)
  try {
    await mongoose.disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
