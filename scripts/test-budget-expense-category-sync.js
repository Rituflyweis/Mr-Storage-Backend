/**
 * Integration test: budget presets + custom lines ↔ expense categories ↔ budget vs actual.
 * Run: node scripts/test-budget-expense-category-sync.js
 * Optional: BASE_URL=http://127.0.0.1:5001 for HTTP layer (server must be running).
 */
require('dotenv').config()
const http = require('http')
const https = require('https')
const mongoose = require('mongoose')
const Lead = require('../src/models/Lead')
const Customer = require('../src/models/Customer')
const User = require('../src/models/User')
const Expense = require('../src/models/Expense')
const ExpenseCategory = require('../src/models/ExpenseCategory')
const ProjectBudget = require('../src/models/ProjectBudget')
const generateExpenseId = require('../src/utils/generateExpenseId')
const {
  normalizeCustomLines,
  buildCostHeadRows,
  resolveTotalBudget,
} = require('../src/utils/budgetVsActual.util')
const {
  ensureDefaultPresetExpenseCategories,
  syncCustomBudgetLinesWithCategories,
} = require('../src/services/budgetExpenseCategorySync.service')
const { DEFAULT_PRESET_CATEGORY_NAMES } = require('../src/config/budgetExpenseCategoryRegistry')

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')
const TEST_LABEL = `Permits QA ${Date.now()}`
const failures = []

const assert = (cond, msg) => {
  if (!cond) failures.push(msg)
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
            json = { raw: data.slice(0, 400) }
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })

async function aggregateExpensesByCategory(leadId) {
  return Expense.aggregate([
    { $match: { leadId: new mongoose.Types.ObjectId(leadId), isActive: true } },
    { $group: { _id: '$category', total: { $sum: '$amount' } } },
  ])
}

async function runDbIntegration(adminId) {
  console.log('\n--- DB integration ---')

  await ensureDefaultPresetExpenseCategories(adminId)
  for (const name of DEFAULT_PRESET_CATEGORY_NAMES) {
    const cat = await ExpenseCategory.findOne({
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    }).lean()
    assert(cat, `Default ExpenseCategory missing: ${name}`)
  }
  console.log('  ✓ Default preset expense categories exist')

  let customer = await Customer.findOne({ email: /budget-sync-qa@/i }).lean()
  if (!customer) {
    customer = await Customer.create({
      customerId: `CUS-BQA-${Date.now()}`,
      firstName: 'Budget QA',
      email: `budget-sync-qa-${Date.now()}@example.com`,
      phone: { number: '5550009999', countryCode: '+1' },
      password: 'unused',
      source: 'manual',
    })
  }

  let lead = await Lead.findOne({ projectName: 'Budget Expense Sync QA Lead', customerId: customer._id }).lean()
  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id,
      projectName: 'Budget Expense Sync QA Lead',
      buildingType: 'Warehouse',
      source: 'manual',
      assignedSales: adminId,
      isHandedToSales: true,
      lifecycleStatus: 'initial_contact',
    })
  }

  const customLines = await syncCustomBudgetLinesWithCategories(
    normalizeCustomLines([{ label: TEST_LABEL, amount: 8000 }]),
    adminId
  )
  assert(customLines.length === 1, 'Expected one custom line after sync')
  assert(
    customLines[0].expenseCategories?.includes(TEST_LABEL) ||
      customLines[0].expenseCategories?.some((c) => c.toLowerCase() === TEST_LABEL.toLowerCase()),
    'Custom line missing expenseCategories for label'
  )

  const budgetDoc = await ProjectBudget.findOneAndUpdate(
    { leadId: lead._id },
    {
      leadId: lead._id,
      materialBudget: 100000,
      logisticBudget: 25000,
      productionBudget: 40000,
      shipperBudget: 15000,
      otherCost: 5000,
      customLines,
      totalBudget: 100000 + 25000 + 40000 + 15000 + 5000 + 8000,
      createdBy: adminId,
    },
    { upsert: true, new: true }
  ).lean()

  const catRow = await ExpenseCategory.findOne({
    name: { $regex: new RegExp(`^${TEST_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  }).lean()
  assert(catRow, 'ExpenseCategory not created for custom budget label')

  await Expense.deleteMany({ leadId: lead._id, description: /^budget-sync-qa:/ })

  const expenseRows = [
    { category: 'Material', amount: 32000, description: 'budget-sync-qa: material' },
    { category: 'Logistics', amount: 5100, description: 'budget-sync-qa: logistics' },
    { category: TEST_LABEL, amount: 2200, description: 'budget-sync-qa: custom' },
    { category: 'Vendor/Freight', amount: 900, description: 'budget-sync-qa: legacy alias' },
  ]

  for (const row of expenseRows) {
    await Expense.create({
      expenseId: await generateExpenseId(),
      category: row.category,
      date: new Date(),
      amount: row.amount,
      description: row.description,
      leadId: lead._id,
      status: 'approved',
      createdBy: adminId,
    })
  }

  const expenseByCategory = await aggregateExpensesByCategory(lead._id)
  const costHeads = buildCostHeadRows(expenseByCategory, budgetDoc)

  const materialHead = costHeads.find((r) => r.head === 'Material Cost')
  const logisticHead = costHeads.find((r) => r.head === 'Carrier/Freight Cost')
  const customHead = costHeads.find((r) => r.isCustom && r.head === TEST_LABEL)

  assert(materialHead, 'Material Cost row missing')
  assert(materialHead.actual === 32900, `Material actual expected 32900 (32000+900 legacy), got ${materialHead?.actual}`)
  assert(logisticHead?.actual === 5100, `Logistics actual expected 5100, got ${logisticHead?.actual}`)
  assert(customHead, `Custom head missing for ${TEST_LABEL}`)
  assert(customHead.actual === 2200, `Custom actual expected 2200, got ${customHead?.actual}`)
  assert(customHead.budget === 8000, `Custom budget expected 8000, got ${customHead?.budget}`)

  const miscHead = costHeads.find((r) => r.head === 'Miscellaneous Cost')
  const miscIncludesCustom = miscHead && miscHead.actual >= 2200
  assert(!miscIncludesCustom, 'Custom category amount must not double-count in Miscellaneous')

  const totalBudget = resolveTotalBudget(budgetDoc)
  assert(totalBudget === 193000, `Total budget expected 193000, got ${totalBudget}`)

  console.log('  ✓ buildCostHeadRows: Material (incl. legacy alias), Logistics, custom line')
  console.log('  ✓ No double-count of custom line in Miscellaneous')
  console.log(`  ✓ leadId=${lead._id}`)

  return { leadId: String(lead._id), adminId }
}

async function runHttpTests(leadId, adminToken) {
  console.log('\n--- HTTP API (optional) ---')

  let res = await request('GET', `/api/admin/leads/${leadId}/budget`, { token: adminToken })
  if (res.status !== 200) {
    console.log(`  ⚠ Skip HTTP: GET budget → ${res.status} (is server running on ${BASE}?)`)
    return
  }

  const budget = res.json.data?.budget
  assert(budget, 'GET budget returned null')
  const card = (budget.planningCards || []).find((c) => c.key === 'material')
  assert(card?.expenseCategories?.includes('Material'), 'planningCards material missing expenseCategories')

  res = await request('POST', `/api/admin/leads/${leadId}/budget/custom-lines`, {
    token: adminToken,
    body: { label: `HTTP Custom ${Date.now()}`, amount: 1000 },
  })
  assert(res.status === 201, `POST custom-lines → ${res.status}`)

  res = await request('GET', `/api/admin/financials/budget-vs-actual?leadId=${leadId}`, {
    token: adminToken,
  })
  assert(res.status === 200, `GET budget-vs-actual → ${res.status}`)
  const heads = res.json.data?.costHeads || []
  assert(heads.some((h) => h.head === 'Material Cost'), 'API costHeads missing Material Cost')
  console.log('  ✓ HTTP: GET budget, POST custom-lines, GET budget-vs-actual')
}

async function main() {
  console.log('[test-budget-expense-category-sync] MONGO_URI db:', process.env.MONGO_URI?.split('/').pop()?.split('?')[0])

  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI required')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO_URI)
  const admin = await User.findOne({ role: 'admin', isActive: true }).select('_id email').lean()
  assert(admin, 'No active admin user in DB — run seed or create admin')
  if (!admin) {
    await mongoose.disconnect()
    process.exit(1)
  }

  const { leadId } = await runDbIntegration(admin._id)

  try {
    const loginRes = await request('POST', '/api/auth/login', {
      body: { email: admin.email, password: process.env.ADMIN_LOGIN_PASSWORD || 'Admin@1234' },
    })
    if (loginRes.status === 200 && loginRes.json.data?.accessToken) {
      await runHttpTests(leadId, loginRes.json.data.accessToken)
    } else {
      console.log('\n--- HTTP API (optional) ---')
      console.log(`  ⚠ Skip HTTP: admin login failed (${loginRes.status}) — set ADMIN_LOGIN_PASSWORD or use seed admin`)
    }
  } catch (e) {
    console.log('\n--- HTTP API (optional) ---')
    console.log(`  ⚠ Skip HTTP: ${e.message}`)
  }

  await mongoose.disconnect()

  if (failures.length) {
    console.error('\nFAILED:')
    failures.forEach((f) => console.error('  -', f))
    process.exit(1)
  }
  console.log('\nAll budget ↔ expense category sync checks passed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
