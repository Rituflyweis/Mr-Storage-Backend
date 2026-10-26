/**
 * Async import test: upload N rows (>50 triggers background job), poll until complete.
 * Usage: node scripts/test-lead-import-async.js [--rows=120] [--full]
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
const { parseExcelToRecords } = require('../src/services/leadExcelImport.service')

const SOURCE = path.join(__dirname, '..', 'Storage Project Leads 2026-10-22.xlsx')
const BASE = `http://127.0.0.1:${env.PORT}`
const args = process.argv.slice(2)
const useFull = args.includes('--full')
const rowLimit = useFull
  ? 2682
  : parseInt(args.find((a) => a.startsWith('--rows='))?.split('=')[1] || '120', 10)

const httpJson = (method, urlPath, token, form) =>
  new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath)
    const headers = { Authorization: `Bearer ${token}` }
    if (form) Object.assign(headers, form.getHeaders())
    const req = http.request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(b) })
          } catch {
            reject(new Error(`${method} ${urlPath} non-JSON ${res.statusCode}: ${b.slice(0, 300)}`))
          }
        })
      }
    )
    req.on('error', reject)
    if (form) form.pipe(req)
    else req.end()
  })

const buildTrimmedXlsx = async (n, stamp) => {
  const buf = fs.readFileSync(SOURCE)
  const { records, headerRowIndex } = await parseExcelToRecords(buf)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const sheet = wb.getWorksheet('Leads') || wb.worksheets[0]
  const start = headerRowIndex + 1
  for (let r = start; r < start + n && r <= sheet.rowCount; r++) {
    const cell = sheet.getRow(r).getCell(3)
    const v = String(cell.value?.text ?? cell.value ?? '')
    if (!v.includes('[async-test-')) cell.value = `${v} [async-test-${stamp}]`
  }
  for (let r = start + n; r <= sheet.rowCount; r++) {
    sheet.getRow(r).eachCell({ includeEmpty: false }, (c) => {
      c.value = null
    })
  }
  const out = path.join(__dirname, '..', `.tmp-async-import-${stamp}.xlsx`)
  await wb.xlsx.writeFile(out)
  return { out, expected: Math.min(n, records.length), stamp }
}

;(async () => {
  await mongoose.connect(env.MONGO_URI)
  const admin = await User.findOne({ role: 'admin', isActive: true })
  const token = jwt.sign(
    { _id: admin._id, email: admin.email, role: admin.role, name: admin.name, isMainAdmin: false },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '2h' }
  )

  const stamp = Date.now()
  const { out, expected, stamp: s } = await buildTrimmedXlsx(rowLimit, stamp)
  const form = new FormData()
  form.append('csv', fs.createReadStream(out), {
    filename: 'leads.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const t0 = Date.now()
  const start = await httpJson('POST', '/api/admin/leads/import', token, form)
  fs.unlinkSync(out)
  console.log('POST import', start.status, start.json.message)
  console.log('data', start.json.data)

  if (start.status !== 202 || !start.json.data?.async) {
    throw new Error('Expected HTTP 202 async job for large import')
  }

  const jobId = start.json.data.jobId
  let last
  while (true) {
    await new Promise((r) => setTimeout(r, 3000))
    const poll = await httpJson('GET', `/api/admin/leads/import/jobs/${jobId}`, token)
    last = poll.json.data
    console.log(
      `[poll] ${last.status} ${last.processedRows}/${last.totalRows} (${last.progressPct}%) created=${last.created}`
    )
    if (last.status === 'completed' || last.status === 'failed') break
    if (Date.now() - t0 > 60 * 60 * 1000) throw new Error('poll timeout 1h')
  }

  if (last.status !== 'completed') throw new Error(last.errorMessage || 'job failed')

  const sample = await Lead.findOne({ projectName: new RegExp(`\\[async-test-${s}\\]`) })
    .select('assignedSales isHandedToSales')
    .lean()
  console.log('Sample lead assignment', sample)
  console.log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s — created ${last.created}, skipped ${last.skipped}`)

  await mongoose.disconnect()
})().catch(async (e) => {
  console.error('FAIL', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
