const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const connectDB = require('../src/config/db')
const { JWT_ACCESS_SECRET } = require('../src/config/env')
const User = require('../src/models/User')
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const FollowUp = require('../src/models/FollowUp')
const LeadTemperatureTransition = require('../src/models/LeadTemperatureTransition')

const API_BASE = 'http://127.0.0.1:5001/api'

const asToken = (user) =>
  jwt.sign(
    { _id: String(user._id), email: user.email, role: user.role, name: user.name },
    JWT_ACCESS_SECRET,
    { expiresIn: '2h' }
  )

const callApi = async ({ method = 'GET', path, token }) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json()
  return { status: res.status, ok: res.ok, json }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const run = async () => {
  await connectDB()
  const now = new Date()
  const stamp = Date.now()
  const report = { startedAt: new Date().toISOString(), scenarios: [] }
  const created = { customers: [], leads: [], followups: [], transitions: [] }

  const scenario = async (name, fn) => {
    try {
      await fn()
      report.scenarios.push({ name, status: 'PASS' })
    } catch (err) {
      report.scenarios.push({ name, status: 'FAIL', error: err.message })
    }
  }

  const admin = await User.findOne({ role: 'admin', isActive: true }).lean()
  const salesA = await User.findOne({ role: 'sales', isActive: true }).lean()
  const salesB = await User.findOne({ role: 'sales', isActive: true, _id: { $ne: salesA?._id } }).lean()
  assert(admin, 'No active admin found')
  assert(salesA, 'No active sales user A found')
  assert(salesB, 'No active sales user B found')

  const adminToken = asToken(admin)
  const salesAToken = asToken(salesA)

  try {
    const customer = await Customer.create({
      customerId: `FU-INS-${stamp}`,
      firstName: 'FollowUp',
      lastName: `Insights${stamp}`,
      email: `followup.insights.${stamp}@example.com`,
      phone: { number: '5557771000', countryCode: '+1' },
      password: 'hashed_test_password',
      source: 'manual',
    })
    created.customers.push(customer._id)

    const leadA = await Lead.create({
      customerId: customer._id,
      assignedSales: salesA._id,
      source: 'manual',
      projectName: `Insights A ${stamp}`,
      lifecycleStatus: 'proposal_sent',
      leadScoring: { score: 55, temperature: 'warm', temperatureManual: true },
    })
    const leadB = await Lead.create({
      customerId: customer._id,
      assignedSales: salesB._id,
      source: 'manual',
      projectName: `Insights B ${stamp}`,
      lifecycleStatus: 'proposal_sent',
      leadScoring: { score: 35, temperature: 'cold', temperatureManual: true },
    })
    created.leads.push(leadA._id, leadB._id)

    const fuRows = await FollowUp.insertMany([
      {
        leadId: leadA._id,
        customerId: customer._id,
        assignedTo: salesA._id,
        createdBy: salesA._id,
        followUpDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        modeOfContact: 'call',
        source: 'manual',
        status: 'pending',
      },
      {
        leadId: leadA._id,
        customerId: customer._id,
        assignedTo: salesA._id,
        createdBy: salesA._id,
        followUpDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        modeOfContact: 'email',
        source: 'manual',
        status: 'completed',
        completedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
      },
      {
        leadId: leadA._id,
        customerId: customer._id,
        assignedTo: salesA._id,
        createdBy: salesA._id,
        followUpDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        modeOfContact: 'sms',
        source: 'chat_dropoff_auto',
        status: 'pending',
      },
      {
        leadId: leadB._id,
        customerId: customer._id,
        assignedTo: salesB._id,
        createdBy: salesB._id,
        followUpDate: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        modeOfContact: 'call',
        source: 'manual',
        status: 'pending',
      },
      {
        leadId: leadB._id,
        customerId: customer._id,
        assignedTo: salesB._id,
        createdBy: salesB._id,
        followUpDate: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        modeOfContact: 'sms',
        source: 'cold_lead_auto',
        status: 'pending',
      },
      // Manual row created by salesA but on leadB to validate "createdBy OR owned lead" logic.
      {
        leadId: leadB._id,
        customerId: customer._id,
        assignedTo: salesB._id,
        createdBy: salesA._id,
        followUpDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
        modeOfContact: 'meeting',
        source: 'manual',
        status: 'pending',
      },
    ])
    created.followups.push(...fuRows.map((f) => f._id))

    const txRows = await LeadTemperatureTransition.insertMany([
      {
        leadId: leadA._id,
        customerId: customer._id,
        fromTemperature: 'warm',
        toTemperature: 'hot',
        source: 'ai_scoring',
        metadata: {
          scoreBefore: 55,
          scoreAfter: 78,
          reason: 'ai_scoring_update',
        },
      },
      {
        leadId: leadA._id,
        customerId: customer._id,
        fromTemperature: 'hot',
        toTemperature: 'warm',
        source: 'manual_override',
        changedBy: salesA._id,
      },
      {
        leadId: leadB._id,
        customerId: customer._id,
        fromTemperature: 'cold',
        toTemperature: 'warm',
        source: 'ai_scoring',
      },
    ])
    created.transitions.push(...txRows.map((t) => t._id))

    await scenario('Default activity for sales returns manual summary', async () => {
      const r = await callApi({ path: '/followups/activity', token: salesAToken })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(r.json?.data?.kind === 'manual', 'Expected default kind manual')
      assert(r.json?.data?.view === 'summary', 'Expected default view summary')
      assert(r.json?.data?.totals?.followUpCount >= 3, 'Expected scoped manual rows for sales')
    })

    await scenario('Automatic activity scope filters by owned sales leads', async () => {
      const r = await callApi({ path: '/followups/activity?kind=automatic', token: salesAToken })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const rows = r.json?.data?.leads || []
      const ids = rows.map((row) => String(row?.lead?._id))
      assert(ids.includes(String(leadA._id)), 'Expected own lead with automatic follow-up to appear')
      assert(!ids.includes(String(leadB._id)), 'Expected non-owned lead not to appear in sales automatic scope')
    })

    await scenario('Detail view requires leadId and returns history', async () => {
      const r = await callApi({
        path: `/followups/activity?kind=manual&view=detail&leadId=${leadA._id}`,
        token: salesAToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(Array.isArray(r.json?.data?.history), 'Expected history array')
      assert(r.json?.data?.history.length >= 2, 'Expected manual history rows for lead A')
    })

    await scenario('Admin manual summary sees all manual leads', async () => {
      const r = await callApi({ path: '/followups/activity?kind=manual', token: adminToken })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const totalLeads = Number(r.json?.data?.totals?.leadCount || 0)
      assert(totalLeads >= 2, `Expected 2 manual leads for admin, got ${totalLeads}`)
    })

    await scenario('Transition summary returns pair counts', async () => {
      const r = await callApi({ path: '/followups/temperature-transition-summary', token: adminToken })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(Number(r.json?.data?.transitions?.warm_to_hot || 0) >= 1, 'Expected warm_to_hot count')
      assert(Number(r.json?.data?.transitions?.hot_to_warm || 0) >= 1, 'Expected hot_to_warm count')
      assert(Number(r.json?.data?.transitions?.cold_to_warm || 0) >= 1, 'Expected cold_to_warm count')
    })

    await scenario('Transition summary for sales is scoped to owned leads', async () => {
      const r = await callApi({
        path: '/followups/temperature-transition-summary',
        token: salesAToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const total = Number(r.json?.data?.totals?.totalTransitions || 0)
      assert(total === 2, `Expected 2 transitions for sales-owned lead, got ${total}`)
    })

    await scenario('Activity summary returns by-score lead fields and transition score state', async () => {
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const r = await callApi({
        path: `/followups/activity?kind=manual&view=summary&startDate=${encodeURIComponent(
          startDate
        )}&endDate=${encodeURIComponent(endDate)}&transitionState=warm_to_hot`,
        token: adminToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const leads = r.json?.data?.leads || []
      assert(leads.length >= 1, 'Expected at least one lead for transitionState filter')
      const withTransition = leads.find((row) => row?.transition)
      assert(withTransition, 'Expected transition column in at least one summary row')
      assert(typeof withTransition?.lead?.customerName === 'string', 'Expected lead.customerName field')
      assert(typeof withTransition?.lead?.location === 'string', 'Expected lead.location field')
      assert(typeof withTransition?.lead?.quoteValue === 'number', 'Expected lead.quoteValue field')
      assert(
        leads.every((row) => row?.transition?.transitionState === 'warm_to_hot'),
        'Expected filtered rows to match transitionState'
      )
      assert(withTransition?.transition?.scoreBefore === 55, 'Expected transition scoreBefore from metadata')
      assert(withTransition?.transition?.scoreAfter === 78, 'Expected transition scoreAfter from metadata')
      assert(withTransition?.transition?.scoreDelta === 23, 'Expected transition scoreDelta')
    })

    await scenario('Transition drilldown query works', async () => {
      const r = await callApi({
        path: '/followups/temperature-transitions?from=hot&to=warm',
        token: adminToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(Number(r.json?.data?.pagination?.total || 0) >= 1, 'Expected drilldown rows')
    })
  } finally {
    if (created.transitions.length) await LeadTemperatureTransition.deleteMany({ _id: { $in: created.transitions } })
    if (created.followups.length) await FollowUp.deleteMany({ _id: { $in: created.followups } })
    if (created.leads.length) await Lead.deleteMany({ _id: { $in: created.leads } })
    if (created.customers.length) await Customer.deleteMany({ _id: { $in: created.customers } })
  }

  report.finishedAt = new Date().toISOString()
  report.passCount = report.scenarios.filter((s) => s.status === 'PASS').length
  report.failCount = report.scenarios.filter((s) => s.status === 'FAIL').length
  console.log(JSON.stringify(report, null, 2))

  await mongoose.connection.close()
  process.exit(report.failCount ? 1 : 0)
}

run().catch(async (err) => {
  console.error('[FOLLOWUP_INSIGHTS_TEST_FAILED]', err.message)
  try {
    await mongoose.connection.close()
  } catch (_) {}
  process.exit(1)
})
