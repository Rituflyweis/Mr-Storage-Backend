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
const { upsertFollowUpEvent } = require('../calendar/calendarSync.service')
const auditService = require('../audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { INACTIVE_LIFECYCLE_STAGES } = require('../../utils/activeLeadScope')
const { sendSms } = require('../sms/sms.service')
const { sendFollowUpNudgeEmail, isEmailConfigured } = require('../email/mailer')

let runner = null

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const DEFAULT_AUTOMATION_CONFIG = {
  key: 'global',
  chatDropOff: {
    enabled: true,
    inactivityMinutes: 30,
    maxAttempts: 3,
    attemptIntervalsMinutes: [30, 180, 1440],
    requireNotQuoteReady: true,
    requireNotHandedToSales: true,
  },
  coldLead: {
    enabled: true,
    intervalsDays: [1, 3, 7, 14],
    maxAttempts: 4,
  },
  leadFollowUp: {
    warm: {
      enabled: true,
      preset: 'twice_week',
      intervalsDays: [3, 7, 10, 14],
      maxAttempts: 4,
    },
    cold: {
      enabled: true,
      preset: 'd7_15_30',
      intervalsDays: [7, 15, 30],
      maxAttempts: 4,
    },
  },
  invoiceReminder: {
    enabled: true,
    intervalsHours: [24, 72, 168],
    maxAttempts: 3,
  },
  manualReminder: {
    defaultReminderMinutes: 30,
    sendDueNowReminder: true,
  },
  channels: {
    sms: true,
    email: true,
  },
  timezone: 'UTC',
}

const fillDefaults = (cfg = {}) => ({
  ...DEFAULT_AUTOMATION_CONFIG,
  ...cfg,
  chatDropOff: {
    ...DEFAULT_AUTOMATION_CONFIG.chatDropOff,
    ...(cfg.chatDropOff || {}),
    // Always enforce internal eligibility checks server-side.
    requireNotQuoteReady: true,
    requireNotHandedToSales: true,
  },
  coldLead: {
    ...DEFAULT_AUTOMATION_CONFIG.coldLead,
    ...(cfg.coldLead || {}),
  },
  leadFollowUp: {
    warm: {
      ...DEFAULT_AUTOMATION_CONFIG.leadFollowUp.warm,
      ...(cfg.leadFollowUp?.warm || {}),
    },
    cold: {
      ...DEFAULT_AUTOMATION_CONFIG.leadFollowUp.cold,
      ...(cfg.leadFollowUp?.cold || cfg.coldLead || {}),
    },
  },
  invoiceReminder: {
    ...DEFAULT_AUTOMATION_CONFIG.invoiceReminder,
    ...(cfg.invoiceReminder || {}),
  },
  manualReminder: {
    ...DEFAULT_AUTOMATION_CONFIG.manualReminder,
    ...(cfg.manualReminder || {}),
  },
  channels: {
    ...DEFAULT_AUTOMATION_CONFIG.channels,
    ...(cfg.channels || {}),
  },
})

const toReadableDateTime = (value) => new Date(value).toLocaleString()
const dueInLine = (minutes) => {
  const n = Number(minutes || 0)
  if (n <= 0) return 'is due now.'
  return `is due in ${n} minutes.`
}

const getOrCreateConfig = async () => {
  const cfg = await FollowUpAutomationConfig.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: DEFAULT_AUTOMATION_CONFIG },
    { upsert: true, new: true }
  )

  const withDefaults = fillDefaults(cfg.toObject())
  const hasDiff = JSON.stringify(cfg.toObject()) !== JSON.stringify(withDefaults)
  if (hasDiff) {
    cfg.set(withDefaults)
    await cfg.save()
    return cfg.toObject()
  }
  return cfg.toObject()
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

const resolveAutomationAssignee = async (lead) => {
  if (lead?.assignedSales) return lead.assignedSales

  const salesUser = await User.findOne({
    role: 'sales',
    isActive: true,
  })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean()
  if (salesUser?._id) return salesUser._id

  const mainAdmin = await User.findOne({
    role: 'admin',
    isMainAdmin: true,
    isActive: true,
  })
    .select('_id')
    .lean()
  if (mainAdmin?._id) return mainAdmin._id

  const anyAdmin = await User.findOne({
    role: 'admin',
    isActive: true,
  })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean()
  return anyAdmin?._id || null
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
  ownerId = null,
  source,
  message,
  modeOfContact = 'sms',
  relatedInvoiceId = null,
  reminderMinutes = 0,
}) => {
  const assignedTo = ownerId || lead.assignedSales || null
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
  const ownerId = await resolveAutomationAssignee(lead)
  const followUp = await createAutomatedFollowUp({
    lead,
    ownerId,
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
    sentBy: ownerId || null,
    config,
    useSms: true,
    useEmail: true,
  })

  if (followUp) {
    await upsertFollowUpEvent(followUp)
    followUp.reminderSentAt = new Date()
    await followUp.save()
  }

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_AUTO_SENT,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy: ownerId || null,
    metadata: {
      kind,
      followUpId: followUp?._id || null,
      message,
      ownerResolvedFrom: lead.assignedSales ? 'assigned_sales' : ownerId ? 'fallback_user' : 'none',
    },
  })
}

const processChatDropOff = async (config) => {
  if (!config?.chatDropOff?.enabled) return { scanned: 0, sent: 0 }
  const now = Date.now()
  const leads = await Lead.find({
    isTerminated: { $ne: true },
    isRaisedToPO: { $ne: true },
    lifecycleStatus: { $nin: INACTIVE_LIFECYCLE_STAGES },
    isChatEnded: { $ne: true },
  })
    .select('_id customerId assignedSales isQuoteReady isHandedToSales createdAt')
    .lean()

  const leadIds = leads.map((l) => l._id)
  const lastMessageMap = await getLastCustomerMessageMap(leadIds)

  let sent = 0
  for (const lead of leads) {
    if (lead.isQuoteReady) continue
    if (lead.isHandedToSales) continue

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
      subject: 'Project follow-up from Steel Building Depot',
      followUpSource: 'chat_dropoff_auto',
      config,
    })
    sent += 1
  }

  return { scanned: leads.length, sent }
}

const processTemperatureLeadFollowUp = async ({
  config,
  temperature,
  source,
  kind,
  message,
  subject,
  fallbackCfg = {},
}) => {
  const leadCfg = config?.leadFollowUp?.[temperature] || fallbackCfg
  if (!leadCfg?.enabled) return { scanned: 0, sent: 0 }
  const now = Date.now()

  const leads = await Lead.find({
    isTerminated: { $ne: true },
    isRaisedToPO: { $ne: true },
    lifecycleStatus: { $nin: INACTIVE_LIFECYCLE_STAGES },
    assignedSales: { $ne: null },
    'leadScoring.temperature': temperature,
  })
    .select('_id customerId assignedSales createdAt')
    .lean()

  let sent = 0
  const intervals = (leadCfg.intervalsDays || []).slice(0, leadCfg.maxAttempts)
  for (const lead of leads) {
    const attempts = await countAttemptsForLeadKind(source, lead._id)
    if (attempts >= intervals.length) continue

    const dueAt = new Date(lead.createdAt).getTime() + intervals[attempts] * DAY
    if (now < dueAt) continue
    const lastAutoAt = await getLastAutoFollowUpAt({ source, leadId: lead._id })
    if (lastAutoAt && now - lastAutoAt < 24 * HOUR) continue
    const customer = await Customer.findById(lead.customerId).lean()
    if (!customer) continue

    await sendLeadAutomation({
      kind,
      lead,
      customer,
      message,
      subject,
      followUpSource: source,
      config,
    })
    sent += 1
  }

  return { scanned: leads.length, sent }
}

const processColdLeadFollowUp = async (config) =>
  processTemperatureLeadFollowUp({
    config,
    temperature: 'cold',
    source: 'cold_lead_auto',
    kind: 'cold_lead',
    message:
      'Hi, just following up on your storage building inquiry. We can help finalize your quote whenever you are ready.',
    subject: 'Checking in on your quote request',
    fallbackCfg: config?.coldLead || {},
  })

const processWarmLeadFollowUp = async (config) =>
  processTemperatureLeadFollowUp({
    config,
    temperature: 'warm',
    source: 'warm_lead_auto',
    kind: 'warm_lead',
    message:
      'Hi, quick follow-up on your project. If you are ready, we can move your quote forward today.',
    subject: 'Quick follow-up on your quote',
    fallbackCfg: { enabled: false, intervalsDays: [], maxAttempts: 0 },
  })

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
  })
    .select('_id leadId customerId assignedTo notes sendSms sendEmail notifyCustomer followUpDate reminderMinutes')
    .lean()

  let sent = 0
  for (const fu of followUps) {
    const reminderMinutes = Number(fu.reminderMinutes ?? config?.manualReminder?.defaultReminderMinutes ?? 30)
    const reminderAt = new Date(fu.followUpDate).getTime() - reminderMinutes * MINUTE
    if (now.getTime() < reminderAt) continue

    const customerMessage = `Reminder: follow-up is scheduled at ${toReadableDateTime(fu.followUpDate)} and ${dueInLine(reminderMinutes)}${fu.notes ? ` Notes: ${fu.notes}` : ''}`
    const staffMessage = `Reminder: follow-up is scheduled at ${toReadableDateTime(fu.followUpDate)} and ${dueInLine(reminderMinutes)}`

    const [customer, assignedUser] = await Promise.all([
      Customer.findById(fu.customerId).lean(),
      User.findById(fu.assignedTo).lean(),
    ])

    if (fu.notifyCustomer && customer) {
      await sendChannels({
        kind: 'manual_followup',
        message: customerMessage,
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
        message: staffMessage,
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
      body: staffMessage,
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
      message: `Reminder: "${m.title}" meeting is scheduled at ${toReadableDateTime(m.meetingTime)} and ${dueInLine(m.reminderMinutes)}`,
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
  const [chatDropOff, warmLead, coldLead, invoiceReminder, manualReminder, meetingReminder] = await Promise.all([
    processChatDropOff(config),
    processWarmLeadFollowUp(config),
    processColdLeadFollowUp(config),
    processInvoiceReminders(config),
    processDueManualFollowUps(config),
    processMeetingReminders(config),
  ])
  return { chatDropOff, warmLead, coldLead, invoiceReminder, manualReminder, meetingReminder }
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
