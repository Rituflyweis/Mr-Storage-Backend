const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const connectDB = require('../src/config/db')
const { JWT_ACCESS_SECRET } = require('../src/config/env')
const User = require('../src/models/User')
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Invoice = require('../src/models/Invoice')
const FollowUp = require('../src/models/FollowUp')
const Meeting = require('../src/models/Meeting')
const CalendarEvent = require('../src/models/CalendarEvent')
const FollowUpAutomationConfig = require('../src/models/FollowUpAutomationConfig')
const FollowUpDispatchLog = require('../src/models/FollowUpDispatchLog')

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

  const created = {
    customers: [],
    leads: [],
    invoices: [],
    followups: [],
    meetings: [],
  }

  const originalConfig = await FollowUpAutomationConfig.findOne({ key: 'global' }).lean()

  try {
    const customer = await Customer.create({
      customerId: `AUTO-CUST-${stamp}-1`,
      firstName: 'Auto',
      lastName: `Test${stamp}`,
      email: `auto.test.${stamp}@example.com`,
      phone: { number: '5550101010', countryCode: '+1' },
      password: 'hashed_test_password',
      source: 'chat',
      company: 'Automation QA',
      location: 'Test City',
    })
    created.customers.push(customer._id)

    const customer2 = await Customer.create({
      customerId: `AUTO-CUST-${stamp}-2`,
      firstName: 'Auto',
      lastName: `Denied${stamp}`,
      email: `auto.denied.${stamp}@example.com`,
      phone: { number: '5550101011', countryCode: '+1' },
      password: 'hashed_test_password',
      source: 'chat',
      company: 'Automation QA',
      location: 'Test City',
    })
    created.customers.push(customer2._id)

    const lead = await Lead.create({
      customerId: customer._id,
      assignedSales: sales._id,
      source: 'chat',
      projectName: `Automation Lead ${stamp}`,
      lifecycleStatus: 'initial_contact',
      isQuoteReady: false,
      isHandedToSales: false,
      leadScoring: { temperature: 'cold', temperatureManual: true, score: 10 },
    })
    created.leads.push(lead._id)

    const unassignedLead = await Lead.create({
      customerId: customer2._id,
      source: 'chat',
      projectName: `Automation Unassigned ${stamp}`,
      lifecycleStatus: 'initial_contact',
      isQuoteReady: false,
      isHandedToSales: false,
      leadScoring: { temperature: 'cold', temperatureManual: true, score: 10 },
    })
    created.leads.push(unassignedLead._id)

    const sentAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
    const invoice = await Invoice.create({
      leadId: lead._id,
      customerId: customer._id,
      createdBy: admin._id,
      invoiceNumber: `AUTO-INV-${stamp}`,
      status: 'sent',
      sentAt,
      lineItems: [],
      subtotal: 1000,
      markupTotal: 0,
      tax: 0,
      discount: 0,
      depositAmount: 0,
      totalAmount: 1000,
    })
    created.invoices.push(invoice._id)

    const manualFollowup = await FollowUp.create({
      leadId: lead._id,
      customerId: customer._id,
      assignedTo: sales._id,
      createdBy: sales._id,
      followUpDate: new Date(Date.now() - 10 * 60 * 1000),
      modeOfContact: 'sms',
      reminderMinutes: 5,
      notifyCustomer: true,
      sendSms: true,
      sendEmail: true,
      source: 'manual',
      notes: 'Manual QA reminder follow-up',
    })
    created.followups.push(manualFollowup._id)

    const meeting = await Meeting.create({
      customerId: customer._id,
      leadId: lead._id,
      title: `Automation Meeting ${stamp}`,
      createdBy: sales._id,
      meetingTime: new Date(Date.now() + 5 * 60 * 1000),
      mode: 'online',
      meetingLink: 'https://example.com/meeting-test',
      reminderMinutes: 10,
      reminderSms: true,
      reminderEmail: true,
    })
    created.meetings.push(meeting._id)

    const scenario = async (name, fn) => {
      try {
        await fn()
        report.scenarios.push({ name, status: 'PASS' })
      } catch (err) {
        report.scenarios.push({ name, status: 'FAIL', error: err.message })
      }
    }

    await scenario('Config GET allowed for sales', async () => {
      const r = await callApi({ path: '/followup-automation/config', token: salesToken })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      assert(r.json?.success === true, 'Expected success true')
    })

    await scenario('Config PUT blocked for sales', async () => {
      const r = await callApi({
        method: 'PUT',
        path: '/followup-automation/config',
        token: salesToken,
        body: { timezone: 'UTC' },
      })
      assert(r.status === 403, `Expected 403, got ${r.status}`)
    })

    await scenario('Config PUT allowed for admin', async () => {
      const r = await callApi({
        method: 'PUT',
        path: '/followup-automation/config',
        token: adminToken,
        body: {
          chatDropOff: {
            enabled: true,
            inactivityMinutes: 0,
            maxAttempts: 3,
            attemptIntervalsMinutes: [0, 60, 180],
            requireNotQuoteReady: true,
            requireNotHandedToSales: true,
          },
          coldLead: { enabled: true, intervalsDays: [0, 1, 3], maxAttempts: 3 },
          invoiceReminder: { enabled: true, intervalsHours: [0, 24, 72], maxAttempts: 3 },
          manualReminder: { defaultReminderMinutes: 30, sendDueNowReminder: true },
          channels: { sms: true, email: true },
          timezone: 'UTC',
        },
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
    })

    await scenario('Sales can send immediate follow-up on own lead', async () => {
      const r = await callApi({
        method: 'POST',
        path: `/followup-automation/chat/${lead._id}/send-now`,
        token: salesToken,
        body: { message: 'QA: Immediate chat follow-up check.' },
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
    })

    await scenario('Sales blocked from immediate follow-up on unassigned lead', async () => {
      const r = await callApi({
        method: 'POST',
        path: `/followup-automation/chat/${unassignedLead._id}/send-now`,
        token: salesToken,
        body: { message: 'QA: Should be denied.' },
      })
      assert(r.status === 403, `Expected 403, got ${r.status}`)
    })

    let firstRunCounts = null
    await scenario('Admin run-now executes automation sweep', async () => {
      const r = await callApi({
        method: 'POST',
        path: '/followup-automation/run-now',
        token: adminToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const data = r.json?.data || {}
      assert(data.chatDropOff, 'Missing chatDropOff result')
      assert(data.coldLead, 'Missing coldLead result')
      assert(data.invoiceReminder, 'Missing invoiceReminder result')
      assert(data.manualReminder, 'Missing manualReminder result')
      assert(data.meetingReminder, 'Missing meetingReminder result')
      firstRunCounts = data
    })

    await scenario('Sales follow-up create accepts reminder fields and sms mode', async () => {
      const r = await callApi({
        method: 'POST',
        path: '/sales/followups',
        token: salesToken,
        body: {
          leadId: String(lead._id),
          followUpDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          modeOfContact: 'sms',
          reminderMinutes: 45,
          notifyCustomer: true,
          sendSms: true,
          sendEmail: false,
          notes: 'QA sales followup',
          priority: 'medium',
        },
      })
      assert(r.status === 201, `Expected 201, got ${r.status}`)
      assert(r.json?.data?.followUp?.modeOfContact === 'sms', 'Expected sms mode saved')
      created.followups.push(r.json.data.followUp._id)
    })

    await scenario('Admin follow-up create accepts reminder fields', async () => {
      const r = await callApi({
        method: 'POST',
        path: '/admin/followups',
        token: adminToken,
        body: {
          leadId: String(lead._id),
          assignedTo: String(sales._id),
          followUpDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          modeOfContact: 'email',
          reminderMinutes: 15,
          notifyCustomer: false,
          sendSms: false,
          sendEmail: true,
          notes: 'QA admin followup',
          priority: 'high',
        },
      })
      assert(r.status === 201, `Expected 201, got ${r.status}`)
      created.followups.push(r.json.data.followUp._id)
    })

    await scenario('Sales meeting create supports reminder controls', async () => {
      const r = await callApi({
        method: 'POST',
        path: '/sales/meetings',
        token: salesToken,
        body: {
          customerId: String(customer._id),
          leadId: String(lead._id),
          title: 'QA sales meeting',
          meetingTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          mode: 'online',
          meetingLink: 'https://example.com/qa-sales',
          reminderMinutes: 20,
          reminderSms: true,
          reminderEmail: false,
        },
      })
      assert(r.status === 201, `Expected 201, got ${r.status}`)
      created.meetings.push(r.json.data.meeting._id)
    })

    await scenario('Admin meeting create supports reminder controls', async () => {
      const r = await callApi({
        method: 'POST',
        path: '/admin/meetings',
        token: adminToken,
        body: {
          customerId: String(customer._id),
          leadId: String(lead._id),
          title: 'QA admin meeting',
          meetingTime: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          mode: 'online',
          meetingLink: 'https://example.com/qa-admin',
          reminderMinutes: 25,
          reminderSms: false,
          reminderEmail: true,
        },
      })
      assert(r.status === 201, `Expected 201, got ${r.status}`)
      created.meetings.push(r.json.data.meeting._id)
    })

    await scenario('Calendar events API returns synced follow-up and meeting entries', async () => {
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const r = await callApi({
        method: 'GET',
        path: `/calendar/events?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
        token: salesToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const events = r.json?.data?.events || []
      const hasMeeting = events.some((e) => String(e.sourceModel) === 'Meeting')
      const hasFollowUp = events.some((e) => String(e.sourceModel) === 'FollowUp')
      assert(hasMeeting, 'Expected at least one synced meeting calendar event')
      assert(hasFollowUp, 'Expected at least one synced follow-up calendar event')
    })

    await scenario('Calendar reminder API updates reminder and syncs source', async () => {
      const event = await CalendarEvent.findOne({
        userId: sales._id,
        sourceModel: 'Meeting',
        sourceId: { $in: created.meetings },
      }).lean()
      assert(event, 'Expected meeting calendar event to exist')

      const r = await callApi({
        method: 'PUT',
        path: `/calendar/events/${event._id}/reminder`,
        token: salesToken,
        body: {
          reminderMinutes: 12,
          reminderSms: false,
          reminderEmail: true,
        },
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const meetingRow = await Meeting.findById(event.sourceId).lean()
      assert(Number(meetingRow.reminderMinutes) === 12, 'Expected meeting reminderMinutes to sync from calendar')
      assert(meetingRow.reminderSms === false, 'Expected meeting reminderSms to sync from calendar')
      assert(meetingRow.reminderEmail === true, 'Expected meeting reminderEmail to sync from calendar')
    })

    await scenario('Meeting reschedule/cancel reflects in calendar event', async () => {
      const meetingId = created.meetings[0]
      const newTime = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
      const edit = await callApi({
        method: 'PUT',
        path: `/sales/meetings/${meetingId}`,
        token: salesToken,
        body: {
          meetingTime: newTime,
          status: 'rescheduled',
        },
      })
      assert(edit.status === 200, `Expected 200 on reschedule, got ${edit.status}`)

      const e1 = await CalendarEvent.findOne({ sourceModel: 'Meeting', sourceId: meetingId }).lean()
      assert(new Date(e1.startsAt).toISOString() === new Date(newTime).toISOString(), 'Expected calendar startsAt updated on reschedule')
      assert(e1.status === 'scheduled', 'Expected calendar event to remain scheduled on reschedule')

      const cancel = await callApi({
        method: 'PUT',
        path: `/sales/meetings/${meetingId}`,
        token: salesToken,
        body: { status: 'cancelled' },
      })
      assert(cancel.status === 200, `Expected 200 on cancel, got ${cancel.status}`)
      const e2 = await CalendarEvent.findOne({ sourceModel: 'Meeting', sourceId: meetingId }).lean()
      assert(e2.status === 'cancelled', 'Expected calendar event status cancelled')
    })

    await scenario('Follow-up complete reflects completed status in calendar event', async () => {
      const fu = await callApi({
        method: 'POST',
        path: '/sales/followups',
        token: salesToken,
        body: {
          leadId: String(lead._id),
          followUpDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          modeOfContact: 'call',
          reminderMinutes: 10,
          notes: 'Complete status sync test',
        },
      })
      assert(fu.status === 201, `Expected 201, got ${fu.status}`)
      const followUpId = fu.json?.data?.followUp?._id
      created.followups.push(followUpId)

      const done = await callApi({
        method: 'PUT',
        path: `/sales/followups/${followUpId}/complete`,
        token: salesToken,
      })
      assert(done.status === 200, `Expected 200 on complete, got ${done.status}`)

      const evt = await CalendarEvent.findOne({ sourceModel: 'FollowUp', sourceId: followUpId }).lean()
      assert(evt?.status === 'completed', 'Expected follow-up calendar event completed')
    })

    await scenario('Second run-now respects cooldown (no immediate repeat sends)', async () => {
      const before = await FollowUp.countDocuments({
        leadId: lead._id,
        source: { $in: ['chat_dropoff_auto', 'cold_lead_auto', 'invoice_auto'] },
      })
      const r = await callApi({
        method: 'POST',
        path: '/followup-automation/run-now',
        token: adminToken,
      })
      assert(r.status === 200, `Expected 200, got ${r.status}`)
      const after = await FollowUp.countDocuments({
        leadId: lead._id,
        source: { $in: ['chat_dropoff_auto', 'cold_lead_auto', 'invoice_auto'] },
      })
      assert(after === before, `Expected no new immediate auto followups, before=${before} after=${after}`)
      report.cooldownCheck = { before, after, firstRunCounts }
    })

    await scenario('Dispatch logs created for test customer', async () => {
      const sentLogs = await FollowUpDispatchLog.countDocuments({
        customerId: customer._id,
        status: 'sent',
      })
      assert(sentLogs > 0, 'Expected at least one sent dispatch log for test customer')
      report.dispatchLogCountForTestCustomer = sentLogs
    })
  } finally {
    if (originalConfig) {
      await FollowUpAutomationConfig.findOneAndUpdate(
        { key: 'global' },
        { $set: originalConfig }
      )
    }
    if (created.meetings.length) {
      await Meeting.deleteMany({ _id: { $in: created.meetings } })
    }
    if (created.followups.length) {
      await FollowUp.deleteMany({ _id: { $in: created.followups } })
    }
    if (created.invoices.length) {
      await Invoice.deleteMany({ _id: { $in: created.invoices } })
    }
    if (created.leads.length) {
      await CalendarEvent.deleteMany({ leadId: { $in: created.leads } })
    }
    if (created.leads.length) {
      await Lead.deleteMany({ _id: { $in: created.leads } })
    }
    if (created.customers.length) {
      await Customer.deleteMany({ _id: { $in: created.customers } })
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
  console.error('[SCENARIO_TEST_FAILED]', err.message)
  try {
    await mongoose.connection.close()
  } catch (_) {}
  process.exit(1)
})
