const FollowUpAutomationConfig = require('../../models/FollowUpAutomationConfig')
const FollowUpDispatchLog = require('../../models/FollowUpDispatchLog')
const FollowUp = require('../../models/FollowUp')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Message = require('../../models/Message')
const Invoice = require('../../models/Invoice')
const Meeting = require('../../models/Meeting')
const User = require('../../models/User')
const Notification = require('../../models/Notification')
const auditService = require('../audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { sendSms } = require('../sms/sms.service')
const { sendFollowUpNudgeEmail, isEmailConfigured } = require('../email/mailer')

let runner = null

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const getOrCreateConfig = async () => {
  const cfg = await FollowUpAutomationConfig.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { upsert: true, new: true }
  ).lean()
  return cfg
}

const normalizePhone = (countryCode, phone) => {
  const cc = String(countryCode || '').trim()
  const pn = String(phone || '').trim().replace(/\s+/g, '')
  const raw = `${cc}${pn}`.replace(/\s+/g, '')
  if (!raw) return ''
  if (raw.startsWith('+')) return raw
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? `+${digits}` : ''
}

const logDispatch = async (payload) => {
  await FollowUpDispatchLog.create(payload)
}

const sendChannels = async ({
  kind,
  message,
  subject,
  customer,
  leadId = null,
  followUpId = null,
  invoiceId = null,
  meetingId = null,
  sentBy = null,
  config,
  useSms = true,
  useEmail = true,
}) => {
  const smsAllowed = Boolean(config?.channels?.sms) && useSms
  const emailAllowed = Boolean(config?.channels?.email) && useEmail
  const toSms = normalizePhone(customer?.phone?.countryCode, customer?.phone?.number || customer?.phone)
  const toEmail = String(customer?.email || '').trim().toLowerCase()
  const customerId = customer?._id || null
  const customerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim() || 'there'

  if (smsAllowed && toSms) {
    try {
      await sendSms({ to: toSms, body: message })
      await logDispatch({ kind, channel: 'sms', status: 'sent', leadId, customerId, followUpId, invoiceId, meetingId, sentBy })
    } catch (err) {
      await logDispatch({
        kind,
        channel: 'sms',
        status: 'failed',
        leadId,
        customerId,
        followUpId,
        invoiceId,
        meetingId,
        sentBy,
        error: err.message || 'sms failed',
      })
    }
  }

  if (emailAllowed && toEmail) {
    try {
      if (isEmailConfigured()) {
        await sendFollowUpNudgeEmail({ toEmail, customerName, subject, message })
        await logDispatch({ kind, channel: 'email', status: 'sent', leadId, customerId, followUpId, invoiceId, meetingId, sentBy })
      } else {
        await logDispatch({
          kind,
          channel: 'email',
          status: 'skipped',
          leadId,
          customerId,
          followUpId,
          invoiceId,
          meetingId,
          sentBy,
          error: 'email_not_configured',
        })
      }
    } catch (err) {
      await logDispatch({
        kind,
        channel: 'email',
        status: 'failed',
        leadId,
        customerId,
        followUpId,
        invoiceId,
        meetingId,
        sentBy,
        error: err.message || 'email failed',
      })
    }
  }
}

const countAttemptsForLeadKind = async (source, leadId) =>
  FollowUp.countDocuments({ leadId, source })

const countAttemptsForInvoice = async (invoiceId) =>
  FollowUp.countDocuments({ source: 'invoice_auto', relatedInvoiceId: invoiceId })

const getLastAutoFollowUpAt = async ({ source, leadId = null, invoiceId = null }) => {
  const filter = { source }
  if (leadId) filter.leadId = leadId
  if (invoiceId) filter.relatedInvoiceId = invoiceId
  const row = await FollowUp.findOne(filter).sort({ createdAt: -1 }).select('createdAt').lean()
  return row?.createdAt ? new Date(row.createdAt).getTime() : 0
}

const getLastCustomerMessageMap = async (leadIds) => {
  if (!leadIds.length) return new Map()
  const rows = await Message.aggregate([
    { $match: { leadId: { $in: leadIds }, senderType: 'customer' } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$leadId', lastMessageAt: { $first: '$createdAt' } } },
  ])
  const map = new Map()
  for (const row of rows) map.set(String(row._id), row.lastMessageAt)
  return map
}

const createAutomatedFollowUp = async ({
  lead,
  source,
  message,
  modeOfContact = 'sms',
  relatedInvoiceId = null,
  reminderMinutes = 0,
}) => {
  const assignedTo = lead.assignedSales || null
  if (!assignedTo) return null
  return FollowUp.create({
    leadId: lead._id,
    customerId: lead.customerId,
    assignedTo,
    createdBy: assignedTo,
    followUpDate: new Date(),
    modeOfContact,
    reminderMinutes,
    notifyCustomer: true,
    sendSms: true,
    sendEmail: true,
    notes: message,
    source,
    relatedInvoiceId,
  })
}

const sendLeadAutomation = async ({
  kind,
  lead,
  customer,
  message,
  subject,
  followUpSource,
  modeOfContact = 'sms',
  relatedInvoiceId = null,
  config,
}) => {
  const followUp = await createAutomatedFollowUp({
    lead,
    source: followUpSource,
    message,
    modeOfContact,
    relatedInvoiceId,
  })

  await sendChannels({
    kind,
    message,
    subject,
    customer,
    leadId: lead._id,
    followUpId: followUp?._id || null,
    invoiceId: relatedInvoiceId,
    sentBy: lead.assignedSales || null,
    config,
    useSms: true,
    useEmail: true,
  })

  if (followUp) {
    followUp.reminderSentAt = new Date()
    await followUp.save()
  }

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_AUTO_SENT,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy: lead.assignedSales || null,
    metadata: { kind, followUpId: followUp?._id || null, message },
  })
}

const processChatDropOff = async (config) => {
  if (!config?.chatDropOff?.enabled) return { scanned: 0, sent: 0 }
  const now = Date.now()
  const leads = await Lead.find({
    isTerminated: { $ne: true },
    lifecycleStatus: { $nin: ['won', 'lost'] },
    isChatEnded: { $ne: true },
  })
    .select('_id customerId assignedSales isQuoteReady isHandedToSales createdAt')
    .lean()

  const leadIds = leads.map((l) => l._id)
  const lastMessageMap = await getLastCustomerMessageMap(leadIds)

  let sent = 0
  for (const lead of leads) {
    if (!lead.assignedSales) continue
    if (config.chatDropOff.requireNotQuoteReady && lead.isQuoteReady) continue
    if (config.chatDropOff.requireNotHandedToSales && lead.isHandedToSales) continue

    const lastMsgAt = lastMessageMap.get(String(lead._id)) || lead.createdAt
    const inactiveMs = now - new Date(lastMsgAt).getTime()
    if (inactiveMs < config.chatDropOff.inactivityMinutes * MINUTE) continue

    const attempts = await countAttemptsForLeadKind('chat_dropoff_auto', lead._id)
    const cappedIntervals = (config.chatDropOff.attemptIntervalsMinutes || []).slice(
      0,
      config.chatDropOff.maxAttempts
    )
    if (attempts >= cappedIntervals.length) continue

    const dueAt = new Date(lastMsgAt).getTime() + cappedIntervals[attempts] * MINUTE
    if (now < dueAt) continue
    const lastAutoAt = await getLastAutoFollowUpAt({ source: 'chat_dropoff_auto', leadId: lead._id })
    if (lastAutoAt && now - lastAutoAt < 60 * MINUTE) continue

    const customer = await Customer.findById(lead.customerId).lean()
    if (!customer) continue

    await sendLeadAutomation({
      kind: 'chat_dropoff',
      lead,
      customer,
      message:
        'Hi, we are checking in on your project details. Reply to this message and our sales team will assist right away.',
      subject: 'Project follow-up from Storage Materials',
      followUpSource: 'chat_dropoff_auto',
      config,
    })
    sent += 1
  }

  return { scanned: leads.length, sent }
}

const processColdLeadFollowUp = async (config) => {
  if (!config?.coldLead?.enabled) return { scanned: 0, sent: 0 }
  const now = Date.now()

  const leads = await Lead.find({
    isTerminated: { $ne: true },
    lifecycleStatus: { $nin: ['won', 'lost'] },
    assignedSales: { $ne: null },
    'leadScoring.temperature': 'cold',
  })
    .select('_id customerId assignedSales createdAt')
    .lean()

  let sent = 0
  const intervals = (config.coldLead.intervalsDays || []).slice(0, config.coldLead.maxAttempts)
  for (const lead of leads) {
    const attempts = await countAttemptsForLeadKind('cold_lead_auto', lead._id)
    if (attempts >= intervals.length) continue

    const dueAt = new Date(lead.createdAt).getTime() + intervals[attempts] * DAY
    if (now < dueAt) continue
    const lastAutoAt = await getLastAutoFollowUpAt({ source: 'cold_lead_auto', leadId: lead._id })
    if (lastAutoAt && now - lastAutoAt < 24 * HOUR) continue
    const customer = await Customer.findById(lead.customerId).lean()
    if (!customer) continue

    await sendLeadAutomation({
      kind: 'cold_lead',
      lead,
      customer,
      message:
        'Hi, just following up on your storage building inquiry. We can help finalize your quote whenever you are ready.',
      subject: 'Checking in on your quote request',
      followUpSource: 'cold_lead_auto',
      config,
    })
    sent += 1
  }

  return { scanned: leads.length, sent }
}

const processInvoiceReminders = async (config) => {
  if (!config?.invoiceReminder?.enabled) return { scanned: 0, sent: 0 }
  const now = Date.now()
  const invoices = await Invoice.find({
    status: { $in: ['sent', 'overdue'] },
  })
    .select('_id leadId customerId sentAt createdAt invoiceNumber totalAmount')
    .lean()

  let sent = 0
  const intervals = (config.invoiceReminder.intervalsHours || []).slice(
    0,
    config.invoiceReminder.maxAttempts
  )

  for (const invoice of invoices) {
    const attempts = await countAttemptsForInvoice(invoice._id)
    if (attempts >= intervals.length) continue

    const baseDate = invoice.sentAt || invoice.createdAt
    const dueAt = new Date(baseDate).getTime() + intervals[attempts] * HOUR
    if (now < dueAt) continue
    const lastAutoAt = await getLastAutoFollowUpAt({ source: 'invoice_auto', invoiceId: invoice._id })
    if (lastAutoAt && now - lastAutoAt < 24 * HOUR) continue

    const [lead, customer] = await Promise.all([
      Lead.findById(invoice.leadId).select('_id customerId assignedSales').lean(),
      Customer.findById(invoice.customerId).lean(),
    ])
    if (!lead || !customer || !lead.assignedSales) continue

    await sendLeadAutomation({
      kind: 'invoice_reminder',
      lead,
      customer,
      message: `Reminder: invoice ${invoice.invoiceNumber || ''} for $${Number(invoice.totalAmount || 0).toFixed(2)} is pending approval/payment. Please contact us if you need any support.`,
      subject: `Reminder: Invoice ${invoice.invoiceNumber || ''}`,
      followUpSource: 'invoice_auto',
      modeOfContact: 'email',
      relatedInvoiceId: invoice._id,
      config,
    })
    sent += 1
  }

  return { scanned: invoices.length, sent }
}

const processDueManualFollowUps = async (config) => {
  if (!config?.manualReminder?.sendDueNowReminder) return { scanned: 0, sent: 0 }
  const now = new Date()
  const followUps = await FollowUp.find({
    status: 'pending',
    source: 'manual',
    reminderSentAt: null,
    followUpDate: { $lte: now },
  })
    .select('_id leadId customerId assignedTo notes sendSms sendEmail notifyCustomer')
    .lean()

  let sent = 0
  for (const fu of followUps) {
    const [customer, assignedUser] = await Promise.all([
      Customer.findById(fu.customerId).lean(),
      User.findById(fu.assignedTo).lean(),
    ])

    if (fu.notifyCustomer && customer) {
      await sendChannels({
        kind: 'manual_followup',
        message:
          fu.notes ||
          'Hi, this is a scheduled follow-up from Storage Materials. Please reply and we will assist you.',
        subject: 'Scheduled follow-up reminder',
        customer,
        leadId: fu.leadId,
        followUpId: fu._id,
        sentBy: fu.assignedTo,
        config,
        useSms: fu.sendSms,
        useEmail: fu.sendEmail,
      })
      sent += 1
    }

    if (assignedUser) {
      const staffProxyCustomer = {
        _id: assignedUser._id,
        firstName: assignedUser.name,
        email: assignedUser.email,
        phone: assignedUser.phone,
      }
      await sendChannels({
        kind: 'manual_followup',
        message: `Reminder: follow-up is due now for lead ${String(fu.leadId)}.`,
        subject: 'Follow-up due now',
        customer: staffProxyCustomer,
        leadId: fu.leadId,
        followUpId: fu._id,
        sentBy: fu.assignedTo,
        config,
        useSms: true,
        useEmail: true,
      })
    }

    await FollowUp.updateOne({ _id: fu._id }, { $set: { reminderSentAt: new Date() } })
    await Notification.create({
      userId: fu.assignedTo,
      leadId: fu.leadId,
      title: 'Follow-up due now',
      body: 'A scheduled follow-up is now due.',
      type: 'followup',
      priority: 'medium',
      refId: fu._id,
      refModel: 'FollowUp',
    })
  }

  return { scanned: followUps.length, sent }
}

const processMeetingReminders = async (config) => {
  const meetings = await Meeting.find({
    status: 'scheduled',
    reminderSentAt: null,
  })
    .select('_id leadId customerId createdBy title meetingTime reminderMinutes reminderSms reminderEmail')
    .lean()
  let sent = 0
  const now = Date.now()

  for (const m of meetings) {
    const dueAt = new Date(m.meetingTime).getTime() - Number(m.reminderMinutes || 30) * MINUTE
    if (now < dueAt) continue
    const user = await User.findById(m.createdBy).lean()
    if (!user) continue
    const staffProxyCustomer = {
      _id: user._id,
      firstName: user.name,
      email: user.email,
      phone: user.phone,
    }
    await sendChannels({
      kind: 'meeting_reminder',
      message: `Reminder: "${m.title}" meeting is scheduled at ${new Date(m.meetingTime).toLocaleString()}.`,
      subject: 'Meeting reminder',
      customer: staffProxyCustomer,
      leadId: m.leadId,
      meetingId: m._id,
      sentBy: m.createdBy,
      config,
      useSms: m.reminderSms !== false,
      useEmail: m.reminderEmail !== false,
    })
    await Meeting.updateOne({ _id: m._id }, { $set: { reminderSentAt: new Date() } })
    sent += 1
  }

  return { scanned: meetings.length, sent }
}

const runAutomationSweep = async () => {
  const config = await getOrCreateConfig()
  const [chatDropOff, coldLead, invoiceReminder, manualReminder, meetingReminder] = await Promise.all([
    processChatDropOff(config),
    processColdLeadFollowUp(config),
    processInvoiceReminders(config),
    processDueManualFollowUps(config),
    processMeetingReminders(config),
  ])
  return { chatDropOff, coldLead, invoiceReminder, manualReminder, meetingReminder }
}

const startAutomationRunner = () => {
  if (runner) return
  runner = setInterval(async () => {
    try {
      await runAutomationSweep()
    } catch (err) {
      console.error('[FollowUpAutomation] sweep failed:', err.message)
    }
  }, 60 * 1000)
}

const stopAutomationRunner = () => {
  if (!runner) return
  clearInterval(runner)
  runner = null
}

module.exports = {
  getOrCreateConfig,
  runAutomationSweep,
  startAutomationRunner,
  stopAutomationRunner,
}
