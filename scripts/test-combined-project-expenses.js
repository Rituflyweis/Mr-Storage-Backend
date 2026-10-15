/**
 * Local integration tests: combined project expenses (manual + email vendor/material + freight).
 * Run: node scripts/test-combined-project-expenses.js
 * Requires: MONGO_URI in .env (JWT secrets needed only for HTTP smoke test).
 */
require('dotenv').config()
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const http = require('http')

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}
const assertNear = (a, b, msg, eps = 0.01) => {
  if (Math.abs(Number(a) - Number(b)) > eps) throw new Error(`ASSERT: ${msg} (got ${a}, expected ${b})`)
}

const TAG = `TEST-EXP-${Date.now()}`
const cleanup = { leadIds: [], expenseIds: [], shipperIds: [], lineIds: [], deliveryIds: [], freightIds: [], budgetIds: [], customerId: null }

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('Missing MONGO_URI in .env — cannot run integration tests.')
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log('[test] Connected to MongoDB')

  const User = require('../src/models/User')
  const Customer = require('../src/models/Customer')
  const Lead = require('../src/models/Lead')
  const Expense = require('../src/models/Expense')
  const ShipperRequest = require('../src/models/ShipperRequest')
  const VendorQuoteLine = require('../src/models/VendorQuoteLine')
  const Delivery = require('../src/models/Delivery')
  const FreightBid = require('../src/models/FreightBid')
  const ProjectBudget = require('../src/models/ProjectBudget')

  const {
    aggregateProjectExpenses,
    aggregateProjectExpensesByLeadMap,
    aggregateEmailBidExpenses,
  } = require('../src/utils/projectExpenseAggregate.util')
  const analyticsReports = require('../src/services/accountAnalyticsReports.service')
  const accountProject = require('../src/services/accountProject.service')
  const { buildPeriodPL } = require('../src/utils/profitLossPeriod.util')

  const user = await User.findOne({ role: { $in: ['account', 'admin'] }, isActive: true }).select('_id').lean()
  assert(user, 'Need an active account/admin user in DB')
  const customer = await Customer.findOne().select('_id').lean()
  assert(customer, 'Need at least one Customer in DB')
  cleanup.customerId = customer._id

  const lead = await Lead.create({
    customerId: customer._id,
    projectName: `${TAG} Project`,
    jobId: `${TAG}-JOB`,
    quoteValue: 500000,
    lifecycleStatus: 'payment_done',
    isTerminated: false,
    isArchived: false,
  })
  cleanup.leadIds.push(lead._id)
  const leadId = lead._id
  const fakeRef = new mongoose.Types.ObjectId()

  const now = new Date()
  const [expApproved, expPending, expOutOfRange] = await Expense.insertMany([
    {
      expenseId: `${TAG}-E1`,
      category: 'materials',
      date: now,
      amount: 100,
      status: 'approved',
      isActive: true,
      leadId,
      createdBy: user._id,
    },
    {
      expenseId: `${TAG}-E2`,
      category: 'labour',
      date: now,
      amount: 50,
      status: 'pending',
      isActive: true,
      leadId,
      createdBy: user._id,
    },
    {
      expenseId: `${TAG}-E3`,
      category: 'materials',
      date: new Date('2020-01-01'),
      amount: 9999,
      status: 'approved',
      isActive: true,
      leadId,
      createdBy: user._id,
    },
  ])
  cleanup.expenseIds.push(expApproved._id, expPending._id, expOutOfRange._id)

  const shipperApproved = await ShipperRequest.create({
    leadId,
    consolidatedBOMId: fakeRef,
    vendorId: fakeRef,
    token: `${TAG}-approved`,
    status: 'approved',
    quoteValue: 200,
  })
  const shipperPending = await ShipperRequest.create({
    leadId,
    consolidatedBOMId: fakeRef,
    vendorId: fakeRef,
    token: `${TAG}-pending`,
    status: 'submitted',
    quoteValue: null,
  })
  cleanup.shipperIds.push(shipperApproved._id, shipperPending._id)

  const [line1, line2] = await VendorQuoteLine.insertMany([
    {
      shipperRequestId: shipperPending._id,
      leadId,
      consolidatedBOMId: fakeRef,
      vendorId: fakeRef,
      amount: 40,
      qty: 1,
      unitPrice: 40,
    },
    {
      shipperRequestId: shipperPending._id,
      leadId,
      consolidatedBOMId: fakeRef,
      vendorId: fakeRef,
      amount: 35,
      qty: 7,
      unitPrice: 5,
    },
  ])
  cleanup.lineIds.push(line1._id, line2._id)

  const delivery = await Delivery.create({
    leadId,
    deliveryNumber: `${TAG}-DEL`,
    status: 'draft',
  })
  cleanup.deliveryIds.push(delivery._id)

  const freight = await FreightBid.create({
    deliveryId: delivery._id,
    carrierId: fakeRef,
    token: `${TAG}-freight`,
    status: 'selected',
    quotedAmount: 25,
  })
  cleanup.freightIds.push(freight._id)

  const budget = await ProjectBudget.create({
    leadId,
    totalBudget: 400,
    createdBy: user._id,
  })
  cleanup.budgetIds.push(budget._id)

  // All-time manual: 100+50+9999; vendor 200+75; freight 25
  const rollup = await aggregateProjectExpenses([leadId])
  console.log('[test] aggregateProjectExpenses (all dates):', JSON.stringify(rollup, null, 2))
  assertNear(rollup.manualExpenseTotal, 10149, 'manual total all dates incl. legacy-dated row')
  assertNear(rollup.vendorMaterialApproved, 200, 'approved vendor quote')
  assertNear(rollup.vendorMaterialPending, 75, 'pending vendor lines 40+35')
  assertNear(rollup.freightFromBids, 25, 'freight bid')
  assertNear(rollup.totalExpense, 10449, 'combined totalExpense all dates')
  assertNear(rollup.budgetedExpense, 400, 'budget')
  assertNear(rollup.budgetVariance, 10049, 'budget variance all dates')

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  const rollupDate = await aggregateProjectExpenses([leadId], {
    date: { $gte: monthStart, $lte: monthEnd },
  })
  assertNear(rollupDate.manualExpenseTotal, 150, 'manual in current month only (excludes 9999)')
  assertNear(rollupDate.totalExpense, 450, 'bids still included when manual date-filtered')

  const byLead = await aggregateProjectExpensesByLeadMap([leadId])
  const row = byLead.get(String(leadId))
  assert(row, 'byLeadMap has lead')
  assertNear(row.totalExpense, 10449, 'byLeadMap total matches all-time rollup')

  const bidsOnly = await aggregateEmailBidExpenses([leadId])
  assertNear(bidsOnly.total, 300, 'email bids only 200+75+25')

  const byLeadFiltered = await aggregateProjectExpensesByLeadMap([leadId], {
    date: { $gte: monthStart, $lte: monthEnd },
  })
  assertNear(byLeadFiltered.get(String(leadId)).totalExpense, 450, 'byLeadMap respects manual date filter')

  const manualOnly = rollupDate.manualExpenseTotal
  const bidPart = rollupDate.totalExpense - manualOnly
  assertNear(bidPart, 300, 'date-filtered rollup: bid portion unchanged')

  const pl = await buildPeriodPL({ leadId }, { date: { $gte: monthStart, $lte: monthEnd } })
  assert(
    pl.expenseBreakdown.totalExpenses >= 300,
    'P&L total expenses includes bid costs on top of manual'
  )

  const projectDetail = await accountProject.getProjectDetail(`${TAG}-JOB`)
  const totalCostRow = projectDetail.profitabilityOverview.find((r) => r.key === 'totalCost')
  assert(totalCostRow, 'project detail profitability rows')
  assertNear(totalCostRow.actual, 10449, 'project detail totalCost actual (all sources)')

  const expenseReport = await analyticsReports.getProjectWiseExpense({
    search: TAG,
    page: 1,
    limit: 10,
    months: 2,
  })
  assert(expenseReport.rows.length >= 1, 'project-wise expense finds test project')
  const reportRow = expenseReport.rows.find((r) => String(r.leadId) === String(leadId))
  assert(reportRow, 'expense report row for test lead')
  assertNear(reportRow.totalExpense, 10449, 'report row totalExpense all-time')
  assertNear(reportRow.sources.manualExpenses, 10149, 'report manual split')
  assertNear(reportRow.sources.vendorMaterialFromEmailBids, 275, 'report vendor split')
  assertNear(reportRow.sources.freightFromEmailBids, 25, 'report freight split')

  // Consistency: summary includes our project when searching TAG
  assert(
    expenseReport.summary.totalExpense >= 10449,
    'portfolio summary includes test project expenses'
  )

  await httpSmoke(user._id, leadId)

  const marginSvc = require('../src/services/accountMarginAnalysis.service')
  const marginSummary = await marginSvc.getMarginAnalysisSummary({
    projectId: String(leadId),
    startDate: monthStart.toISOString(),
    endDate: monthEnd.toISOString(),
  })
  assert(marginSummary.totals, 'margin analysis summary totals')
  assert(
    marginSummary.totals.cogs >= 300,
    'margin COGS includes email bid costs for scoped project'
  )

  const sampleLeads = await Lead.find({ isTerminated: { $ne: true } }).limit(5).distinct('_id')
  for (const id of sampleLeads) {
    await aggregateProjectExpenses([id])
  }
  console.log(`[test] aggregateProjectExpenses smoke on ${sampleLeads.length} existing leads OK`)

  console.log('\n[test] All combined expense integration checks passed.')
}

async function httpSmoke(userId, leadId) {
  if (!process.env.JWT_ACCESS_SECRET) {
    console.warn('[test] Skip HTTP smoke — JWT_ACCESS_SECRET not set')
    return
  }
  const app = require('../app')
  const token = jwt.sign({ _id: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '5m' })
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  const { port } = server.address()
  const base = `http://127.0.0.1:${port}/api/account/reports`

  const get = (path) =>
    new Promise((resolve, reject) => {
      http.get(
        `${base}${path}`,
        { headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, json: JSON.parse(body) })
            } catch (e) {
              reject(e)
            }
          })
        }
      ).on('error', reject)
    })

  const expenseRes = await get(`/project-wise-expense?search=${encodeURIComponent(TAG)}&limit=5`)
  assert(expenseRes.status === 200, `HTTP project-wise-expense status ${expenseRes.status}`)
  assert(expenseRes.json.success === true, 'HTTP expense success envelope')
  assert(
    expenseRes.json.data.summary.totalExpense >= 10449,
    'HTTP expense summary total'
  )

  const incomeRes = await get(`/project-wise-income?search=${encodeURIComponent(TAG)}&limit=5`)
  assert(incomeRes.status === 200, `HTTP project-wise-income status ${incomeRes.status}`)
  assert(incomeRes.json.success === true, 'HTTP income success envelope')

  const plRes = await get(`/profit-loss?leadId=${leadId}&limit=5`)
  assert(plRes.status === 200, `HTTP profit-loss status ${plRes.status}`)

  await new Promise((resolve) => server.close(resolve))
  console.log('[test] HTTP smoke on /api/account/reports/* passed')
}

async function teardown() {
  const Expense = require('../src/models/Expense')
  const ShipperRequest = require('../src/models/ShipperRequest')
  const VendorQuoteLine = require('../src/models/VendorQuoteLine')
  const Delivery = require('../src/models/Delivery')
  const FreightBid = require('../src/models/FreightBid')
  const ProjectBudget = require('../src/models/ProjectBudget')
  const Lead = require('../src/models/Lead')

  if (cleanup.expenseIds.length) await Expense.deleteMany({ _id: { $in: cleanup.expenseIds } })
  if (cleanup.lineIds.length) await VendorQuoteLine.deleteMany({ _id: { $in: cleanup.lineIds } })
  if (cleanup.shipperIds.length) await ShipperRequest.deleteMany({ _id: { $in: cleanup.shipperIds } })
  if (cleanup.freightIds.length) await FreightBid.deleteMany({ _id: { $in: cleanup.freightIds } })
  if (cleanup.deliveryIds.length) await Delivery.deleteMany({ _id: { $in: cleanup.deliveryIds } })
  if (cleanup.budgetIds.length) await ProjectBudget.deleteMany({ _id: { $in: cleanup.budgetIds } })
  if (cleanup.leadIds.length) await Lead.deleteMany({ _id: { $in: cleanup.leadIds } })
}

main()
  .catch((err) => {
    console.error('\n[test] FAILED:', err.message)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await teardown()
      console.log('[test] Cleaned up fixture data')
    } catch (e) {
      console.warn('[test] Cleanup warning:', e.message)
    }
    await mongoose.disconnect()
  })
