/* eslint-disable no-console */
require('dotenv').config()

const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const connectDB = require('../src/config/db')
const { JWT_ACCESS_SECRET } = require('../src/config/env')

const User = require('../src/models/User')
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Quotation = require('../src/models/Quotation')
const FollowUpAutomationConfig = require('../src/models/FollowUpAutomationConfig')
const FollowUpTemplate = require('../src/models/FollowUpTemplate')

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:5001/api'

const asToken = (user) =>
  jwt.sign(
    {
      _id: String(user._id),
      email: user.email,
      role: user.role,
      name: user.name,
      isMainAdmin: user.role === 'admin' ? Boolean(user.isMainAdmin) : false,
    },
    JWT_ACCESS_SECRET,
    { expiresIn: '2h' }
  )

const callApi = async ({ method = 'GET', path, token, body, expectText = false }) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (expectText) {
    const text = await res.text()
    return { status: res.status, ok: res.ok, text }
  }

  let json = null
  try {
    json = await res.json()
  } catch (_) {}
  return { status: res.status, ok: res.ok, json }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = async () => {
  await connectDB()

  const report = {
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    scenarios: [],
  }

  const admin = await User.findOne({ role: 'admin', isActive: true }).lean()
  const sales = await User.findOne({ role: 'sales', isActive: true }).lean()
  assert(admin, 'No active admin user found')
  assert(sales, 'No active sales user found')

  const adminToken = asToken(admin)
  const salesToken = asToken(sales)
  const stamp = Date.now()

  const created = {
    customerIds: [],
    leadIds: [],
    quotationIds: [],
    templateIds: [],
  }

  const originalConfig = await FollowUpAutomationConfig.findOne({ key: 'global' }).lean()

  const scenario = async (name, fn) => {
    try {
      await fn()
      report.scenarios.push({ name, status: 'PASS' })
    } catch (err) {
      report.scenarios.push({ name, status: 'FAIL', error: err.message })
    }
  }

  try {
    await scenario('Follow-up templates: create/list/get/update/delete', async () => {
      const create = await callApi({
        method: 'POST',
        path: '/followups/templates',
        token: adminToken,
        body: {
          title: `QA Template ${stamp}`,
          message: 'Hello from QA template',
          category: 'chat',
          sortOrder: 7,
          isActive: true,
        },
      })
      assert(create.status === 201, `Create expected 201, got ${create.status}`)
      const templateId = create.json?.data?.template?._id
      assert(templateId, 'Missing templateId in create response')
      created.templateIds.push(templateId)

      const list = await callApi({
        path: '/followups/templates?search=QA%20Template',
        token: salesToken,
      })
      assert(list.status === 200, `List expected 200, got ${list.status}`)
      const listHas = (list.json?.data?.templates || []).some((t) => String(t._id) === String(templateId))
      assert(listHas, 'Created template not found in list')

      const getOne = await callApi({
        path: `/followups/templates/${templateId}`,
        token: salesToken,
      })
      assert(getOne.status === 200, `Get expected 200, got ${getOne.status}`)
      assert(getOne.json?.data?.template?.title, 'Missing template title in get response')

      const update = await callApi({
        method: 'PUT',
        path: `/followups/templates/${templateId}`,
        token: adminToken,
        body: { title: `QA Template ${stamp} Updated`, message: 'Updated template message' },
      })
      assert(update.status === 200, `Update expected 200, got ${update.status}`)
      assert(update.json?.data?.template?.title?.includes('Updated'), 'Template title not updated')

      const del = await callApi({
        method: 'DELETE',
        path: `/followups/templates/${templateId}`,
        token: adminToken,
      })
      assert(del.status === 200, `Delete expected 200, got ${del.status}`)
    })

    await scenario('Follow-up config: mismatch intervals vs maxAttempts returns 400', async () => {
      const r = await callApi({
        method: 'PUT',
        path: '/followup-automation/config',
        token: adminToken,
        body: {
          leadFollowUp: {
            cold: {
              enabled: true,
              maxAttempts: 4,
              intervalsDays: [1, 3, 7, 14, 21],
            },
          },
        },
      })
      assert(r.status === 400, `Expected 400, got ${r.status}`)
      assert(
        String(r.json?.message || '').includes('must exactly match maxAttempts'),
        `Unexpected message: ${r.json?.message || 'none'}`
      )
    })

    await scenario('Follow-up config: comma-separated interval string accepted when counts match', async () => {
      const r = await callApi({
        method: 'PUT',
        path: '/followup-automation/config',
        token: adminToken,
        body: {
          leadFollowUp: {
            warm: {
              enabled: true,
              maxAttempts: 4,
              intervalsDays: '3,7,10,14',
            },
          },
        },
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const intervals = r.json?.data?.config?.leadFollowUp?.warm?.intervalsDays || []
      assert(Array.isArray(intervals) && intervals.length === 4, 'Warm intervals were not persisted as array of 4')
    })

    await scenario('Quotation send: emailMessage key is accepted and reported', async () => {
      const customer = await Customer.create({
        customerId: `QA-CUST-${stamp}`,
        firstName: 'Qa',
        lastName: 'SendQuote',
        email: `qa.sendquote.${stamp}@example.com`,
        phone: { countryCode: '+1', number: '5550102020' },
        password: 'hashed_test_password',
        source: 'chat',
      })
      created.customerIds.push(customer._id)

      const lead = await Lead.create({
        customerId: customer._id,
        assignedSales: sales._id,
        source: 'chat',
        projectName: `QA Lead ${stamp}`,
        lifecycleStatus: 'initial_contact',
        isQuoteReady: false,
        isHandedToSales: false,
      })
      created.leadIds.push(lead._id)

      const quotation = await Quotation.create({
        leadId: lead._id,
        customerId: customer._id,
        createdBy: admin._id,
        quoteNumber: `QA-Q-${stamp}`,
        buildingType: 'PEMB',
        finalPrice: 12345,
        totalCOGS: 10000,
        markupPercent: 23,
        markupValue: 2345,
        approval: {
          status: 'approved',
          reviewedBy: admin._id,
          reviewedAt: new Date(),
          approvedVersionNumber: 1,
          history: [{ status: 'approved', note: 'qa approved', by: admin._id, at: new Date() }],
        },
        status: 'draft',
        versionNumber: 1,
      })
      created.quotationIds.push(quotation._id)

      const send = await callApi({
        method: 'POST',
        path: `/quotations/${quotation._id}/send`,
        token: adminToken,
        body: {
          emailMessage: 'Hi, this is a QA emailMessage payload check.',
          sections: ['quote'],
        },
      })

      assert(send.status === 200, `Send expected 200, got ${send.status} (${send.json?.message || 'no message'})`)
      assert(send.json?.data?.messageIncluded === true, 'Expected messageIncluded=true')
      assert(send.json?.data?.messageSourceKey === 'emailMessage', 'Expected messageSourceKey=emailMessage')
    })

    await scenario('Quotation HTML preview contains Steel Building Depot branding', async () => {
      const quotationId = created.quotationIds[0]
      assert(quotationId, 'Missing quotation id for branding check')
      const html = await callApi({
        path: `/quotations/${quotationId}/pdf?format=html`,
        token: adminToken,
        expectText: true,
      })
      assert(html.status === 200, `Expected 200, got ${html.status}`)
      assert(
        html.text.includes('Steel Building Depot') || html.text.includes('STEEL BUILDING'),
        'Branding text not found in generated HTML preview'
      )
      assert(!html.text.includes('storagematerials.com'), 'Old storagematerials.com branding still present')
    })
  } finally {
    if (originalConfig) {
      await FollowUpAutomationConfig.findOneAndUpdate({ key: 'global' }, { $set: originalConfig })
    }

    if (created.templateIds.length) {
      await FollowUpTemplate.deleteMany({ _id: { $in: created.templateIds } })
    }
    if (created.quotationIds.length) {
      await Quotation.deleteMany({ _id: { $in: created.quotationIds } })
    }
    if (created.leadIds.length) {
      await Lead.deleteMany({ _id: { $in: created.leadIds } })
    }
    if (created.customerIds.length) {
      await Customer.deleteMany({ _id: { $in: created.customerIds } })
    }
  }

  report.finishedAt = new Date().toISOString()
  report.passCount = report.scenarios.filter((s) => s.status === 'PASS').length
  report.failCount = report.scenarios.filter((s) => s.status === 'FAIL').length
  console.log(JSON.stringify(report, null, 2))

  await mongoose.connection.close()
  process.exit(report.failCount ? 1 : 0)
}

run().catch(async (err) => {
  console.error('[LATEST_API_DELTA_TEST_FAILED]', err.message)
  try {
    await mongoose.connection.close()
  } catch (_) {}
  process.exit(1)
})
