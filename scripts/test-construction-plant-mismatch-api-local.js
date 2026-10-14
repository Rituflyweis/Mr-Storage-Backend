#!/usr/bin/env node
/**
 * HTTP integration tests against a running local server (not DB-only).
 * Usage: BASE_URL=http://localhost:5001 node scripts/test-construction-plant-mismatch-api-local.js
 */
require('dotenv').config()
const mongoose = require('mongoose')

const BASE = (process.env.BASE_URL || 'http://localhost:5001').replace(/\/$/, '')
const CONSTRUCTION_EMAIL = process.env.TEST_CONSTRUCTION_EMAIL || 'claude.qa.construction@internal-test.mrstorage.dev'
const PLANT_EMAIL = process.env.TEST_PLANT_EMAIL || 'claude.qa.plant@internal-test.mrstorage.dev'
const PASSWORD = process.env.TEST_STAFF_PASSWORD || 'ClaudeQA@2026'

let passed = 0
let failed = 0

const log = (ok, name, detail = '') => {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function request(method, path, { token, body } = {}) {
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { _raw: text }
  }
  return { status: res.status, json }
}

async function login(email) {
  const { status, json } = await request('POST', '/api/auth/login', {
    body: { email, password: PASSWORD },
  })
  if (status !== 200 || !json?.data?.accessToken) {
    throw new Error(`Login failed for ${email}: HTTP ${status} ${JSON.stringify(json)}`)
  }
  return json.data.accessToken
}

async function main() {
  console.log(`\nLocal API tests → ${BASE}\n`)

  // Health: root
  try {
    const health = await fetch(`${BASE}/`)
    log(health.ok || health.status < 500, 'Server reachable', `HTTP ${health.status}`)
  } catch (e) {
    log(false, 'Server reachable', e.message)
    console.error('\nStart the server first: npm start\n')
    process.exit(1)
  }

  let constructionToken
  let plantToken
  try {
    constructionToken = await login(CONSTRUCTION_EMAIL)
    log(true, 'Construction login')
    plantToken = await login(PLANT_EMAIL)
    log(true, 'Plant login')
  } catch (e) {
    log(false, 'Staff login', e.message)
    console.error('Run: node scripts/ensureMyTestStaff.js')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO_URI)
  const User = require('../src/models/User')
  const POOrder = require('../src/models/POOrder')
  const Bundle = require('../src/models/Bundle')

  const plantUser = await User.findOne({ email: PLANT_EMAIL }).select('_id').lean()
  let scopedLeadId = null
  if (plantUser) {
    const po = await POOrder.findOne({ assignedTo: plantUser._id, status: 'approved' })
      .select('leadId')
      .lean()
    if (po?.leadId) scopedLeadId = String(po.leadId)
  }

  let bundle = scopedLeadId
    ? await Bundle.findOne({ leadId: scopedLeadId }).sort({ updatedAt: -1 }).lean()
    : null
  if (!bundle) {
    bundle = await Bundle.findOne().sort({ updatedAt: -1 }).lean()
  }
  if (!bundle) {
    log(false, 'Find sample bundle in DB', 'no bundles — skip bundle-specific tests')
    await mongoose.disconnect()
    process.exit(1)
  }
  const leadId = String(bundle.leadId)
  const bundleId = String(bundle._id)
  const sampleItemId = bundle.items?.[0]?._id ? String(bundle.items[0]._id) : null
  log(true, 'Sample bundle', `${bundle.bundleNo} lead=${leadId}${scopedLeadId === leadId ? ' (plant-scoped)' : ''}`)

  // Phases
  {
    const { status, json } = await request('GET', `/api/construction/projects/${leadId}/phases`, {
      token: constructionToken,
    })
    const ok = status === 200 && json?.success && Array.isArray(json.data?.phases) && Array.isArray(json.data?.steps)
    log(ok, 'GET /construction/projects/:leadId/phases', ok ? `${json.data.phases.length} phases` : `HTTP ${status}`)
  }

  // Progress enriched
  {
    const { status, json } = await request('GET', `/api/construction/projects/${leadId}/progress`, {
      token: constructionToken,
    })
    const ok = status === 200 && json?.data?.steps && json.data.phases
    log(ok, 'GET /construction/projects/:leadId/progress', ok ? `overall ${json.data.overallProgressPct}%` : `HTTP ${status}`)
  }

  // Update step
  {
    const stepKey = 'fabrication_started'
    const { status, json } = await request('PUT', `/api/construction/projects/${leadId}/steps/${stepKey}`, {
      token: constructionToken,
      body: {
        percentComplete: 55,
        notes: 'Local API test update',
        startDate: new Date().toISOString(),
      },
    })
    log(status === 200 && json?.data?.stepDetail?.completionPct === 55, 'PUT /construction/projects/:leadId/steps/:stepKey', `HTTP ${status}`)
  }

  // Project-scoped lists
  for (const path of [
    `/api/construction/labels?projectId=${leadId}&limit=5`,
    `/api/construction/bundle-scan?projectId=${leadId}&limit=5`,
    `/api/construction/packing-lists?projectId=${leadId}&limit=5`,
  ]) {
    const label = path.split('?')[0].split('/').pop()
    const { status, json } = await request('GET', path, { token: constructionToken })
    const ok = status === 200 && json?.success
    log(ok, `GET /construction/${label}?projectId=`, ok ? `total=${json.data?.total ?? 'n/a'}` : `HTTP ${status}`)
  }

  // Report mismatch → creates MMO
  let mismatchId = null
  {
    const body = {
      leadId,
      bundleId,
      reason: 'Local test mismatch',
      notes: 'Automated local HTTP test',
      items: sampleItemId
        ? [{ itemId: sampleItemId, expectedQty: 10, receivedQty: 8 }]
        : [],
      photos: [],
    }
    const { status, json } = await request('POST', `/api/construction/bundles/${bundleId}/report-mismatch`, {
      token: constructionToken,
      body,
    })
    const ok = status === 200 && json?.data?.mismatchOrder?.mismatchOrderId
    mismatchId = json?.data?.mismatchOrder?.mismatchId || null
    log(ok, 'POST /construction/bundles/:bundleId/report-mismatch', ok ? json.data.mismatchOrder.mismatchOrderId : `HTTP ${status} ${JSON.stringify(json?.message)}`)
  }

  // Plant mismatch list
  {
    const { status, json } = await request('GET', `/api/plant/projects/${leadId}/mismatch-orders`, {
      token: plantToken,
    })
    const ok = status === 200 && Array.isArray(json?.data?.mismatchOrders)
    log(ok, 'GET /plant/projects/:leadId/mismatch-orders', ok ? `count=${json.data.total}` : `HTTP ${status}`)
    if (!mismatchId && json?.data?.mismatchOrders?.[0]) {
      mismatchId = json.data.mismatchOrders[0].mismatchId
    }
  }

  // Plant update mismatch status
  if (mismatchId) {
    const { status, json } = await request('PUT', `/api/plant/mismatch-orders/${mismatchId}/status`, {
      token: plantToken,
      body: { status: 'in_review', actionNotes: 'Reviewed in local test' },
    })
    log(status === 200 && json?.data?.mismatchOrder?.status === 'in_review', 'PUT /plant/mismatch-orders/:id/status', `HTTP ${status}`)
  } else {
    log(false, 'PUT /plant/mismatch-orders/:id/status', 'no mismatchId from create')
  }

  // Additional material requests
  {
    const { status, json } = await request('GET', `/api/plant/projects/${leadId}/additional-material-requests`, {
      token: plantToken,
    })
    const ok = status === 200 && Array.isArray(json?.data?.additionalMaterialRequests)
    log(ok, 'GET /plant/projects/:leadId/additional-material-requests', ok ? `total=${json.data.total}` : `HTTP ${status}`)
  }

  // Carrier/vendor next-code (prior deploy)
  {
    const { status, json } = await request('GET', '/api/plant/carriers/next-code', { token: plantToken })
    log(status === 200 && json?.data?.carrierCode, 'GET /plant/carriers/next-code', json?.data?.carrierCode || `HTTP ${status}`)
  }
  {
    const { status, json } = await request('GET', '/api/plant/vendors/next-code', { token: plantToken })
    log(status === 200 && json?.data?.vendorCode, 'GET /plant/vendors/next-code', json?.data?.vendorCode || `HTTP ${status}`)
  }

  await mongoose.disconnect()

  console.log(`\nDone: ${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
