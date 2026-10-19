/**
 * End-to-end tax engine test against running API + MongoDB.
 * Run: node scripts/test-tax-engine-local.js
 * Env: BASE_URL, LOGIN_EMAIL, LOGIN_PASSWORD, TAX_ENGINE=local (default in app)
 */
require('dotenv').config()
const http = require('http')
const https = require('https')
const mongoose = require('mongoose')

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')
const EMAIL = process.env.LOGIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@flyweis.test'
const PASS = process.env.LOGIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Admin@1234'

const assert = (c, m) => {
  if (!c) throw new Error(m)
}

const request = (method, path, { token, body } = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const lib = url.protocol === 'https:' ? https : http
    const payload = body ? JSON.stringify(body) : null
    const req = lib.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let json = null
          try {
            json = JSON.parse(data)
          } catch {
            json = { raw: data }
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })

async function main() {
  console.log('[tax-test] Base URL:', BASE)

  const login = await request('POST', '/api/auth/login', {
    body: { email: EMAIL, password: PASS },
  })
  assert(login.status === 200 && login.json.success, `Login failed: ${login.json.message || login.status}`)
  const token = login.json.data.accessToken
  console.log('[tax-test] Logged in as', login.json.data.user?.email)

  const compliance = await request('GET', '/api/account/financial-extra/tax-compliance/status', { token })
  assert(compliance.status === 200, `compliance HTTP ${compliance.status}`)
  console.log('[tax-test] Compliance:', compliance.json.data)

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI
  assert(mongoUri, 'Set MONGO_URI in .env for direct DB steps')
  await mongoose.connect(mongoUri)
  const Lead = require('../src/models/Lead')
  let lead = await Lead.findOne({
    city: { $ne: '' },
    state: { $ne: '' },
    pincode: { $ne: '' },
  })
    .sort({ updatedAt: -1 })
    .lean()

  if (!lead) {
    lead = await Lead.findOne().sort({ updatedAt: -1 }).lean()
  }
  assert(lead, 'No lead in DB for test')

  await Lead.updateOne(
    { _id: lead._id },
    {
      $set: {
        lifecycleStatus: 'proposal_sent',
        installAddress: {
          line1: lead.location || '100 Test Industrial Blvd',
          city: lead.city || 'Austin',
          state: lead.state || 'TX',
          postalCode: lead.pincode || '78701',
          country: 'US',
        },
        city: lead.city || 'Austin',
        state: lead.state || 'TX',
        pincode: lead.pincode || '78701',
      },
    }
  )
  console.log('[tax-test] Lead ready', lead._id, lead.projectName || lead.jobId)

  const createInv = await request('POST', `/api/leads/${lead._id}/invoices`, {
    token,
    body: {
      subtotal: 100000,
      markupTotal: 0,
      discount: 0,
      tax: 0,
      totalAmount: 100000,
      lineItems: [
        {
          description: 'Materials package',
          items: ['Steel materials'],
          rate: 100000,
          quantity: 1,
          tax: 8250,
          taxAmount: 8250,
          total: 100000,
        },
      ],
    },
  })
  assert(createInv.status === 201 || createInv.status === 200, `create invoice HTTP ${createInv.status}: ${createInv.json.message}`)
  const invoice = createInv.json.data?.invoice
  assert(invoice?._id, 'invoice id missing')
  console.log('[tax-test] Invoice created', invoice.invoiceNumber, 'tax=', invoice.tax, 'avalara=', invoice.avalara)

  if (invoice.approval?.status !== 'approved') {
    const approve = await request('PUT', `/api/invoices/${invoice._id}/approve`, {
      token,
      body: { note: 'tax test auto-approve' },
    })
    if (approve.status !== 200) {
      console.warn('[tax-test] Approve skipped/failed:', approve.status, approve.json.message)
    } else {
      console.log('[tax-test] Invoice approved')
    }
  }

  const markSent = await request('POST', `/api/invoices/${invoice._id}/mark-sent`, {
    token,
    body: { note: 'Tax engine E2E test' },
  })
  assert(markSent.status === 200, `mark-sent HTTP ${markSent.status}: ${markSent.json.message}`)
  const sentInv = markSent.json.data?.invoice
  assert(sentInv?.avalara?.documentStatus === 'Committed' || sentInv?.taxCollected > 0, 'Expected committed tax on sent invoice')
  console.log('[tax-test] Mark sent OK — documentStatus:', sentInv.avalara?.documentStatus, 'taxCollected:', sentInv.taxCollected)

  const sync = await request('POST', '/api/account/financial-extra/state-wise-tax/sync', { token })
  assert(sync.status === 200, `sync HTTP ${sync.status}`)
  console.log('[tax-test] Sync:', sync.json.data)

  const stateTax = await request('GET', '/api/account/financial-extra/state-wise-tax/stats', { token })
  assert(stateTax.status === 200, `state-wise stats HTTP ${stateTax.status}`)
  console.log('[tax-test] State-wise stats:', stateTax.json.data?.totalTaxCollected)

  const projectTax = await request(
    'GET',
    `/api/account/financial-extra/project-wise-tax?projectId=${lead._id}`,
    { token }
  )
  assert(projectTax.status === 200, `project-wise HTTP ${projectTax.status}`)
  console.log('[tax-test] Project-wise rows:', projectTax.json.data?.total)

  await mongoose.disconnect()
  console.log('\n[tax-test] All checks passed.')
}

main().catch((e) => {
  console.error('\n[tax-test] FAILED:', e.message)
  process.exit(1)
})
