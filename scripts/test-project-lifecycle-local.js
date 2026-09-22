/**
 * Local smoke test: plant project lifecycle auto-fill (util + HTTP plant/admin).
 * Usage: node scripts/test-project-lifecycle-local.js
 * Optional: SERVER=1 to require HTTP (start server separately: npm start)
 */

require('dotenv').config()

const mongoose = require('mongoose')
const env = require('../src/config/env')
const Lead = require('../src/models/Lead')
const ProjectStepDetail = require('../src/models/ProjectStepDetail')
const User = require('../src/models/User')
const { PLANT_LIFECYCLE_STAGES } = require('../src/config/constants')
const {
  buildPlantProjectLifecycle,
  completePlantLifecycleStep,
} = require('../src/utils/projectLifecycleSteps.util')

const BASE = `http://localhost:${env.PORT}`
const PLANT_EMAIL =
  process.env.TEST_PLANT_EMAIL || 'claude.qa.plant@internal-test.mrstorage.dev'
const PLANT_PASS = process.env.TEST_PLANT_PASSWORD || 'ClaudeQA@2026'
const ADMIN_EMAIL =
  process.env.TEST_ADMIN_EMAIL || 'claude.qa.admin@internal-test.mrstorage.dev'
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD || 'ClaudeQA@2026'

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

async function api(token, method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 400)}`)
  }
  if (!res.ok || data.success === false) {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${data.message || text.slice(0, 400)}`)
  }
  return data
}

function validateProjectLifecycle(pl, expectedCurrentKey) {
  assert(pl && pl.steps, 'projectLifecycle missing')
  assert(pl.steps.length === 13, `expected 13 steps, got ${pl.steps?.length}`)
  assert(pl.totalSteps === 13, 'totalSteps should be 13')
  assert(pl.currentStepKey === expectedCurrentKey, `currentStepKey ${pl.currentStepKey} !== ${expectedCurrentKey}`)
  const current = pl.steps.find((s) => s.status === 'current')
  assert(current && current.key === expectedCurrentKey, 'current step mismatch in steps[]')
  const completedCount = pl.steps.filter((s) => s.status === 'completed').length
  const idx = PLANT_LIFECYCLE_STAGES.indexOf(expectedCurrentKey)
  assert(completedCount === idx, `completed count ${completedCount} !== index ${idx}`)
}

async function runUtilTest() {
  console.log('\n[util] DB lifecycle advance + buildPlantProjectLifecycle')

  let lead = await Lead.findOne({
    lifecycleStatus: { $in: PLANT_LIFECYCLE_STAGES },
    isDeleted: { $ne: true },
  }).sort({ updatedAt: -1 })

  if (!lead) {
    console.log('[util] no plant lead found — skipping util test (seed a plant project first)')
    return null
  }

  const leadId = lead._id
  const snapshot = {
    lifecycleStatus: lead.lifecycleStatus,
    lifecycleHistory: JSON.parse(JSON.stringify(lead.lifecycleHistory || [])),
    plannedStartDate: lead.plannedStartDate,
  }

  const user = await User.findOne({ role: 'plant', isActive: true }) || { name: 'Test Plant' }

  const beforeStatus = lead.lifecycleStatus
  if (beforeStatus === PLANT_LIFECYCLE_STAGES[PLANT_LIFECYCLE_STAGES.length - 1]) {
    lead.lifecycleStatus = PLANT_LIFECYCLE_STAGES[0]
    lead.lifecycleHistory = [{
      stage: PLANT_LIFECYCLE_STAGES[0],
      changedAt: new Date(),
      changedBy: user._id || null,
    }]
    await lead.save()
    await ProjectStepDetail.deleteMany({ leadId })
  }

  lead = await Lead.findById(leadId)
  const startStatus = lead.lifecycleStatus
  const expectedNext = PLANT_LIFECYCLE_STAGES[PLANT_LIFECYCLE_STAGES.indexOf(startStatus) + 1]
  assert(expectedNext, 'already at final stage after reset')

  const result = await completePlantLifecycleStep(lead, user, { note: 'local util test' })
  assert(!result.error, result.error || 'complete failed')
  assert(result.nextStatus === expectedNext, `next ${result.nextStatus} !== ${expectedNext}`)

  const stepDetails = await ProjectStepDetail.find({ leadId }).lean()
  const pl = buildPlantProjectLifecycle(lead.toObject(), { stepDetails })
  validateProjectLifecycle(pl, expectedNext)

  const completedDetail = stepDetails.find((d) => d.stepKey === startStatus)
  const startedDetail = stepDetails.find((d) => d.stepKey === expectedNext)
  assert(completedDetail?.completedAt, 'completed step missing completedAt')
  assert(startedDetail?.startedAt, 'next step missing startedAt')

  console.log('[util] OK', startStatus, '→', expectedNext)

  lead.lifecycleStatus = snapshot.lifecycleStatus
  lead.lifecycleHistory = snapshot.lifecycleHistory
  lead.plannedStartDate = snapshot.plannedStartDate
  await lead.save()
  await ProjectStepDetail.deleteMany({ leadId, notes: 'local util test' })

  return String(leadId)
}

async function runHttpTest() {
  console.log('\n[http] plant + admin lifecycle APIs')

  let health
  try {
    health = await fetch(`${BASE}/health`).then((r) => r.status)
  } catch {
    health = 0
  }
  if (health !== 200) {
    console.log(`[http] server not on ${BASE} (health ${health}) — start with: npm start`)
    return
  }

  const plantLogin = await api(null, 'POST', '/api/auth/login', {
    email: PLANT_EMAIL,
    password: PLANT_PASS,
  })
  const plantToken = plantLogin.data.accessToken

  const projectsRes = await api(plantToken, 'GET', '/api/plant/projects?limit=20')
  const rows = projectsRes.data?.projects || projectsRes.data?.items || []
  const row = rows.find((r) =>
    PLANT_LIFECYCLE_STAGES.includes(r.status || r.lifecycleStatus),
  ) || rows[0]
  const leadId = row?.leadId || row?._id
  if (!leadId) {
    console.log('[http] skip — plant user has no projects')
    return
  }
  console.log('[http] using lead', leadId, row?.projectName || '')

  const detail1 = await api(plantToken, 'GET', `/api/plant/projects/${leadId}/detail`)
  const status1 = detail1.data.lifecycleStatus
  validateProjectLifecycle(detail1.data.projectLifecycle, status1)

  const advance = await api(plantToken, 'PUT', `/api/plant/projects/${leadId}/lifecycle`, {
    completeCurrentStep: true,
    note: 'local http plant test',
  })
  const status2 = advance.data.lifecycleStatus
  validateProjectLifecycle(advance.data.projectLifecycle, status2)
  assert(status2 !== status1, 'lifecycle should advance')

  const detail2 = await api(plantToken, 'GET', `/api/plant/projects/${leadId}/detail`)
  validateProjectLifecycle(detail2.data.projectLifecycle, status2)

  const adminLogin = await api(null, 'POST', '/api/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASS,
  })
  const adminToken = adminLogin.data.accessToken

  const adminDetail = await api(adminToken, 'GET', `/api/admin/plant/projects/${leadId}/detail`)
  validateProjectLifecycle(adminDetail.data.projectLifecycle, status2)

  const adminAdvance = await api(adminToken, 'PUT', `/api/admin/plant/projects/${leadId}/lifecycle`, {
    completeCurrentStep: true,
  })
  validateProjectLifecycle(adminAdvance.data.projectLifecycle, adminAdvance.data.lifecycleStatus)

  const leadDetail = await api(adminToken, 'GET', `/api/admin/leads/${leadId}/detail`)
  assert(leadDetail.data.projectLifecycle, 'admin getLeadDetail should include projectLifecycle')
  validateProjectLifecycle(leadDetail.data.projectLifecycle, adminAdvance.data.lifecycleStatus)

  // revert two HTTP steps
  const leadDoc = await Lead.findById(leadId)
  const idx = PLANT_LIFECYCLE_STAGES.indexOf(status1)
  if (idx >= 0) {
    leadDoc.lifecycleStatus = status1
    leadDoc.lifecycleHistory = (leadDoc.lifecycleHistory || []).filter(
      (h) => PLANT_LIFECYCLE_STAGES.indexOf(h.stage) <= idx,
    )
    await leadDoc.save()
  }
  await ProjectStepDetail.deleteMany({ leadId, notes: { $in: ['local http plant test'] } })

  console.log('[http] OK plant + admin detail/advance/revert')
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) throw new Error('MONGO_URI / MONGODB_URI required')
  await mongoose.connect(uri)
  console.log('[db] connected')

  await runUtilTest()
  await runHttpTest()

  await mongoose.disconnect()
  console.log('\nAll local lifecycle checks passed.\n')
}

main().catch((err) => {
  console.error('\nFAILED:', err.message)
  process.exit(1)
})
