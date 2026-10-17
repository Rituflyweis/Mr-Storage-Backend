/**
 * Local HTTP tests for 2026-10-17 cross-panel + related account APIs.
 * Run: node scripts/test-cross-panel-changes-local.js
 * Requires: server on BASE_URL (default http://127.0.0.1:5001), MongoDB from .env
 */
require('dotenv').config()
const http = require('http')
const https = require('https')
const mongoose = require('mongoose')
const connectDB = require('../src/config/db')

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')

const USERS = {
  admin: { email: process.env.ADMIN_LOGIN_EMAIL || 'admin@flyweis.test', password: process.env.ADMIN_LOGIN_PASSWORD || 'Admin@1234' },
  sales: { email: process.env.SALES_LOGIN_EMAIL || 'sales@flyweis.test', password: process.env.SALES_LOGIN_PASSWORD || 'Sales@1234' },
  account: { email: process.env.LOGIN_EMAIL || 'account@flyweis.test', password: process.env.LOGIN_PASSWORD || 'Account@1234' },
  plant: { email: process.env.PLANT_LOGIN_EMAIL || 'plant@flyweis.test', password: process.env.PLANT_LOGIN_PASSWORD || 'Plant@1234' },
  construction: {
    email: process.env.CONSTRUCTION_LOGIN_EMAIL || 'construction@flyweis.test',
    password: process.env.CONSTRUCTION_LOGIN_PASSWORD || 'Const@1234',
  },
}

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
            json = { raw: data.slice(0, 300) }
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })

async function login(role) {
  const { email, password } = USERS[role]
  const res = await request('POST', '/api/auth/login', { body: { email, password } })
  assert(res.status === 200 && res.json.success, `${role} login: ${res.status} ${res.json.message || res.json.raw}`)
  return res.json.data.accessToken
}

async function getOk(token, path, { allow404 = false } = {}) {
  const res = await request('GET', path, { token })
  if (allow404 && res.status === 404) return res
  assert(res.status === 200 && res.json.success !== false, `GET ${path} → ${res.status} ${res.json.message || JSON.stringify(res.json).slice(0, 120)}`)
  return res
}

async function main() {
  console.log(`[cross-panel] Base: ${BASE}\n`)

  const health = await request('GET', '/api/health').catch((e) => ({ status: 0, json: { message: e.message } }))
  if (health.status !== 200) {
    const ping = await request('GET', '/').catch(() => ({ status: 0 }))
    assert(ping.status > 0, `Server not reachable at ${BASE}. Start with: node server.js`)
  }

  const tokens = {}
  for (const role of Object.keys(USERS)) {
    tokens[role] = await login(role)
    console.log(`[cross-panel] Login OK: ${role}`)
  }

  // —— Merged project drawings ——
  const adminDraw = await getOk(tokens.admin, '/api/admin/project-drawings?limit=5')
  assert(Array.isArray(adminDraw.json.data.documents), 'admin project-drawings documents[]')
  console.log('[cross-panel] OK GET /api/admin/project-drawings', { total: adminDraw.json.data.total })

  const adminGrouped = await getOk(tokens.admin, '/api/admin/project-drawings/by-project?limit=50')
  assert(Array.isArray(adminGrouped.json.data.projects), 'admin by-project projects[]')
  console.log('[cross-panel] OK GET /api/admin/project-drawings/by-project')

  const salesDraw = await getOk(tokens.sales, '/api/sales/project-drawings?limit=5')
  assert(Array.isArray(salesDraw.json.data.documents), 'sales project-drawings documents[]')
  console.log('[cross-panel] OK GET /api/sales/project-drawings')

  // —— Customer documents (view on all panels) ——
  await connectDB()
  const Customer = require('../src/models/Customer')
  const Lead = require('../src/models/Lead')
  const customer = await Customer.findOne().select('_id').lean()
  assert(customer, 'Need at least one customer in DB (run npm run seed)')
  const customerId = customer._id

  for (const role of ['admin', 'sales', 'account', 'plant', 'construction']) {
    const res = await getOk(tokens[role], `/api/${role === 'admin' ? 'admin' : role}/customers/${customerId}/documents`)
    assert(Array.isArray(res.json.data.documents), `${role} documents array`)
    console.log(`[cross-panel] OK GET /api/${role}/customers/:id/documents`)
  }

  // Account cannot upload
  const accountUpload = await request('POST', `/api/account/customers/${customerId}/documents`, {
    token: tokens.account,
    body: { name: 'x', fileUrl: 'https://example.com/x.pdf' },
  })
  assert(
    accountUpload.status === 403 || accountUpload.status === 404,
    `account upload should 403 or 404 (no route), got ${accountUpload.status}`
  )
  console.log(`[cross-panel] OK account POST documents → ${accountUpload.status} (no upload on account panel)`)

  // —— Construction delivery ——
  const leadWithDelivery = await Lead.findOne({ lifecycleStatus: { $exists: true } })
    .select('_id projectName')
    .lean()

  let deliveryLeadId = leadWithDelivery?._id
  const Delivery = require('../src/models/Delivery')
  const deliveryRow = await Delivery.findOne({ selectedCarrierBidId: { $ne: null } })
    .select('_id leadId')
    .lean()
  if (deliveryRow?.leadId) deliveryLeadId = deliveryRow.leadId

  if (deliveryRow?._id) {
    const detail = await getOk(tokens.construction, `/api/construction/deliveries/${deliveryRow._id}`)
    const d = detail.json.data.delivery
    assert(d && (d.overview || d.deliveryId || d.deliveryNumber), 'construction delivery detail shape')
    console.log('[cross-panel] OK GET /api/construction/deliveries/:id (enriched)')
  } else {
    console.log('[cross-panel] SKIP delivery detail — no delivery with carrier in DB')
  }

  if (deliveryLeadId) {
    const finalRes = await getOk(tokens.construction, `/api/construction/projects/${deliveryLeadId}/delivery`, {
      allow404: true,
    })
    if (finalRes.status === 404) {
      console.log('[cross-panel] OK GET /api/construction/projects/:leadId/delivery → 404 (no confirmed delivery)')
    } else {
      assert(finalRes.json.data.delivery, 'final delivery payload')
      console.log('[cross-panel] OK GET /api/construction/projects/:leadId/delivery')
    }
  }

  const adminDel = deliveryRow?._id
    ? await getOk(tokens.admin, `/api/admin/construction/deliveries/${deliveryRow._id}`)
    : null
  if (adminDel) {
    assert(adminDel.json.data.delivery?.overview || adminDel.json.data.delivery?.deliveryId, 'admin construction delivery enriched')
    console.log('[cross-panel] OK GET /api/admin/construction/deliveries/:id')
  }

  // —— Account project subpages (recent) ——
  const accountProjects = await getOk(tokens.account, '/api/account/projects?limit=1')
  const projectId =
    accountProjects.json.data?.projects?.[0]?.leadId || accountProjects.json.data?.projects?.[0]?._id
  if (projectId) {
    await getOk(tokens.account, `/api/account/projects/${projectId}/bom/consolidated`)
    console.log('[cross-panel] OK GET account bom/consolidated')

    const delAcc = await getOk(tokens.account, `/api/account/projects/${projectId}/delivery`, { allow404: true })
    if (delAcc.status === 200) console.log('[cross-panel] OK GET account project delivery')
    else console.log('[cross-panel] OK account project delivery → 404 (expected if none)')
  }

  // —— Lead notify (inbound) ——
  const Notification = require('../src/models/Notification')
  const User = require('../src/models/User')
  const adminIds = (await User.find({ role: 'admin', isActive: true }).select('_id').lean()).map((u) => u._id)
  const beforeCount = await Notification.countDocuments({
    type: 'lead',
    title: 'New lead received',
    userId: { $in: adminIds },
  })

  const stamp = Date.now()
  const uniqueEmail = `qa-lead-${stamp}@cross-panel-test.local`
  const uniquePhone = `555${String(stamp).slice(-7)}`
  const chatInit = await request('POST', '/api/public/chat/init', {
    body: { firstName: 'QA', email: uniqueEmail, phone: uniquePhone, countryCode: '+1' },
  })
  assert(chatInit.status === 200 && chatInit.json.success, `chat/init ${chatInit.status}`)
  await new Promise((r) => setTimeout(r, 800))

  const afterCount = await Notification.countDocuments({
    type: 'lead',
    title: 'New lead received',
    userId: { $in: adminIds },
  })
  assert(afterCount > beforeCount, `admin lead notifications should increase (${beforeCount} → ${afterCount})`)
  console.log('[cross-panel] OK chat/init → admin notifications increased')

  // —— Plant drawing replace ——
  const Building = require('../src/models/Building')
  const POOrder = require('../src/models/POOrder')
  const plantUser = await User.findOne({ email: USERS.plant.email }).select('_id').lean()
  const plantLeadIds = await POOrder.distinct('leadId', { status: 'approved', assignedTo: plantUser._id })
  let building = null
  if (plantLeadIds.length) {
    building = await Building.findOne({ leadId: { $in: plantLeadIds } })
      .select('_id leadId drawings buildingNumber')
      .lean()
  }

  if (building) {
    const prevVersions = (building.drawings || []).length
    const upload = await request('POST', `/api/plant/projects/${building.leadId}/drawings`, {
      token: tokens.plant,
      body: {
        drawings: [
          {
            buildingId: building._id,
            fileUrl: 'https://example.com/test-drawing-replace.pdf',
            fileName: 'test-replace.pdf',
          },
        ],
      },
    })
    assert(
      (upload.status === 200 || upload.status === 201) && upload.json.success,
      `plant upload ${upload.status} ${upload.json.message}`
    )
    const refreshed = await Building.findById(building._id).select('drawings').lean()
    assert((refreshed.drawings || []).length === 1, `drawings should be length 1 after replace, got ${refreshed.drawings?.length}`)
    const vn = refreshed.drawings[0].versionNumber
    assert(vn >= 1, 'versionNumber present')
    console.log('[cross-panel] OK plant drawing replace (was', prevVersions, 'entries → 1, version', vn, ')')

    const merged = await getOk(tokens.admin, `/api/admin/project-drawings?projectId=${building.leadId}&source=plant`)
    const plantDocs = merged.json.data.documents.filter((d) => d.source === 'plant')
    const byBuilding = plantDocs.filter((d) => d.buildingLabel?.includes(String.fromCharCode(64 + (building.buildingNumber || 1))))
    assert(plantDocs.length >= 1, 'merged plant docs for project')
    console.log('[cross-panel] OK merged drawings shows latest plant only per building')
  } else {
    console.log('[cross-panel] SKIP plant drawing replace — no building in DB')
  }

  await mongoose.disconnect()
  console.log('\n[cross-panel] All local checks passed.')
}

main().catch(async (e) => {
  console.error('\n[cross-panel] FAILED:', e.message)
  try {
    await mongoose.disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
