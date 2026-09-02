const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const connectDB = require('../src/config/db')
const { JWT_ACCESS_SECRET } = require('../src/config/env')
const User = require('../src/models/User')
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Invoice = require('../src/models/Invoice')

const API_BASE = 'http://127.0.0.1:5001/api'

const asToken = (user) =>
  jwt.sign(
    { _id: String(user._id), email: user.email, role: user.role, name: user.name },
    JWT_ACCESS_SECRET,
    { expiresIn: '2h' }
  )

const callApi = async ({ method = 'GET', path, token, body }) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
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
  const stamp = Date.now()
  const report = { startedAt: new Date().toISOString(), scenarios: [] }

  const admin = await User.findOne({ role: 'admin', isActive: true }).lean()
  const sales = await User.findOne({ role: 'sales', isActive: true }).lean()
  assert(admin, 'No active admin user found')
  assert(sales, 'No active sales user found')

  const adminToken = asToken(admin)
  const salesToken = asToken(sales)
  const created = { customers: [], leads: [], invoices: [] }

  const scenario = async (name, fn) => {
    try {
      await fn()
      report.scenarios.push({ name, status: 'PASS' })
    } catch (err) {
      report.scenarios.push({ name, status: 'FAIL', error: err.message })
    }
  }

  try {
    const customer = await Customer.create({
      customerId: `APPR-CUST-${stamp}`,
      firstName: 'Invoice',
      lastName: `Flow${stamp}`,
      email: `invoice.flow.${stamp}@example.com`,
      phone: { number: '5550101022', countryCode: '+1' },
      password: 'hashed_test_password',
      source: 'manual',
      company: 'Invoice QA',
      location: 'Test City',
    })
    created.customers.push(customer._id)

    const lead = await Lead.create({
      customerId: customer._id,
      assignedSales: sales._id,
      source: 'manual',
      projectName: `Invoice Approval ${stamp}`,
      lifecycleStatus: 'proposal_sent',
      isQuoteReady: true,
      isHandedToSales: true,
    })
    created.leads.push(lead._id)

    let invoiceId = null

    await scenario('Sales create invoice auto-submits pending approval', async () => {
      const r = await callApi({
        method: 'POST',
        path: `/leads/${lead._id}/invoices`,
        token: salesToken,
        body: {
          totalAmount: 1500,
          subtotal: 1200,
          tax: 0,
          discount: 0,
          depositAmount: 0,
          lineItems: [{ description: 'Approval workflow test', rate: 1500, quantity: 1, total: 1500 }],
        },
      })
      assert(r.status === 201, `Expected 201, got ${r.status}`)
      invoiceId = r.json?.data?.invoice?._id
      assert(invoiceId, 'Missing invoice ID')
      created.invoices.push(invoiceId)
      assert(r.json?.data?.invoice?.approval?.status === 'pending_approval', 'Expected pending_approval')
      assert(r.json?.data?.invoice?.workflowStatus === 'pending_approval', 'Expected workflow pending_approval')
    })

    await scenario('Sales cannot send before admin approval', async () => {
      const r = await callApi({
        method: 'POST',
        path: `/invoices/${invoiceId}/send`,
        token: salesToken,
      })
      assert(r.status === 400, `Expected 400, got ${r.status}`)
      assert(
        String(r.json?.message || '').toLowerCase().includes('approved'),
        'Expected approval block message'
      )
    })

    await scenario('Admin sees invoice in pending queue', async () => {
      const r = await callApi({
        path: '/invoices/approval/pending',
        token: adminToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const found = (r.json?.data?.invoices || []).some((i) => String(i._id) === String(invoiceId))
      assert(found, 'Expected invoice in pending approval list')
    })

    await scenario('Admin approves invoice', async () => {
      const r = await callApi({
        method: 'PUT',
        path: `/invoices/${invoiceId}/approve`,
        token: adminToken,
        body: { note: 'Approved in QA test' },
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(r.json?.data?.invoice?.approval?.status === 'approved', 'Expected approved')
      assert(r.json?.data?.invoice?.workflowStatus === 'approved', 'Expected workflow approved')
    })

    await scenario('Sales can send after admin approval', async () => {
      const r = await callApi({
        method: 'POST',
        path: `/invoices/${invoiceId}/send`,
        token: salesToken,
      })
      // Mail infra may fail in local/prod; workflow gate should still be removed after approval.
      assert([200, 502].includes(r.status), `Expected 200 or 502, got ${r.status}`)
      if (r.status === 200) {
        assert(r.json?.data?.invoice?.status === 'sent', 'Expected sent status')
        assert(r.json?.data?.invoice?.workflowStatus === 'sent', 'Expected workflow sent')
      } else {
        assert(
          !String(r.json?.message || '').toLowerCase().includes('approved'),
          'Send should fail due delivery, not due approval gate'
        )
      }
    })

    await scenario('Admin can reject pending invoice', async () => {
      const rCreate = await callApi({
        method: 'POST',
        path: `/leads/${lead._id}/invoices`,
        token: salesToken,
        body: { totalAmount: 500, lineItems: [{ description: 'Reject test', rate: 500, quantity: 1, total: 500 }] },
      })
      assert(rCreate.status === 201, `Expected 201, got ${rCreate.status}`)
      const id2 = rCreate.json?.data?.invoice?._id
      assert(id2, 'Missing second invoice id')
      created.invoices.push(id2)

      const rReject = await callApi({
        method: 'PUT',
        path: `/invoices/${id2}/reject`,
        token: adminToken,
        body: { reason: 'Needs corrected line items' },
      })
      assert(rReject.status === 200, `Expected 200, got ${rReject.status}`)
      assert(rReject.json?.data?.invoice?.approval?.status === 'rejected', 'Expected rejected')
    })

    await scenario('Editing rejected invoice resets to not_submitted', async () => {
      const inv = await Invoice.findOne({ leadId: lead._id, 'approval.status': 'rejected' }).sort({ createdAt: -1 }).lean()
      assert(inv, 'Expected rejected invoice row')
      const r = await callApi({
        method: 'PUT',
        path: `/invoices/${inv._id}`,
        token: salesToken,
        body: { description: 'Updated after rejection', totalAmount: Number(inv.totalAmount || 0) + 10 },
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(r.json?.data?.invoice?.approval?.status === 'not_submitted', 'Expected not_submitted after edit')
    })
  } finally {
    if (created.invoices.length) await Invoice.deleteMany({ _id: { $in: created.invoices } })
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
  console.error('[INVOICE_APPROVAL_TEST_FAILED]', err.message)
  try {
    await mongoose.connection.close()
  } catch (_) {}
  process.exit(1)
})
