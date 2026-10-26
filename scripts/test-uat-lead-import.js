#!/usr/bin/env node
/**
 * Test lead import on UAT.
 *   UAT_ADMIN_EMAIL=... UAT_ADMIN_PASSWORD=... node scripts/test-uat-lead-import.js
 *   node scripts/test-uat-lead-import.js --email x --password y [--file path.xlsx]
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const https = require('https')
const FormData = require('form-data')

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

const BASE = process.env.API_BASE || 'https://uat.flyweistechnology.com/api'
const email = getArg('--email') || process.env.UAT_ADMIN_EMAIL
const password = getArg('--password') || process.env.UAT_ADMIN_PASSWORD
const file =
  getArg('--file') ||
  path.join(__dirname, '..', 'Storage Project Leads - Sample 100 for Import Test.xlsx')

const postJson = (urlPath, body, token) =>
  new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath)
    const data = JSON.stringify(body)
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) }))
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })

const getJson = (urlPath, token) =>
  new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath)
    https
      .get(u, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) }))
      })
      .on('error', reject)
  })

const uploadImport = (token, filePath) =>
  new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('csv', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const u = new URL(BASE + '/admin/leads/import')
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname,
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) }))
      }
    )
    req.on('error', reject)
    form.pipe(req)
  })

;(async () => {
  if (!email || !password) {
    console.error('Set UAT_ADMIN_EMAIL + UAT_ADMIN_PASSWORD or pass --email / --password')
    process.exit(2)
  }
  if (!fs.existsSync(file)) {
    console.error('Missing file:', file)
    process.exit(2)
  }

  console.log('API:', BASE)
  const login = await postJson('/auth/login', { email, password })
  if (!login.json.success) {
    console.error('Login failed:', login.status, login.json.message)
    process.exit(1)
  }
  const token = login.json.data.accessToken
  console.log('Logged in as', login.json.data.user?.role || login.json.data.role)

  const imp = await uploadImport(token, file)
  console.log('Import HTTP', imp.status)
  console.log(JSON.stringify(imp.json, null, 2))

  const jobId = imp.json.data?.jobId
  if (jobId) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const poll = await getJson(`/admin/leads/import/jobs/${jobId}`, token)
      const d = poll.json.data
      console.log(`[poll ${i + 1}]`, d.status, `${d.processedRows}/${d.totalRows}`, 'created', d.created ?? d.imported)
      if (d.status === 'completed' || d.status === 'failed') break
    }
  }
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
