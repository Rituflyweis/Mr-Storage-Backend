const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const FollowUpAutomationConfig = require('../../models/FollowUpAutomationConfig')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const {
  getOrCreateConfig,
  runAutomationSweep,
} = require('../../services/followup/followUpAutomation.service')
const { sendSms } = require('../../services/sms/sms.service')
const { sendFollowUpNudgeEmail, isEmailConfigured } = require('../../services/email/mailer')
const { success, badRequest, forbidden, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const MAX_ATTEMPTS_LIMIT = 4

const parseIntervalArray = (value) => {
  if (Array.isArray(value)) return value.map((v) => Number(v))
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isFinite(v))
    return parts.length ? parts : []
  }
  return []
}

const normalizePhone = (countryCode, phone) => {
  const ccDigits = String(countryCode || '')
    .replace(/[^\d]/g, '')
    .trim()
  const phoneDigits = String(phone || '')
    .replace(/[^\d]/g, '')
    .trim()
  if (!ccDigits && !phoneDigits) return ''

  // If number already has country code (common in CRM imports), trust it.
  if (phoneDigits.length >= 11) return `+${phoneDigits}`

  if (ccDigits) {
    if (phoneDigits.startsWith(ccDigits)) return `+${phoneDigits}`
    return `+${ccDigits}${phoneDigits}`
  }

  return phoneDigits ? `+${phoneDigits}` : ''
}

const normalizeLeadFollowUpPayload = (payload = {}) => {
  const warmFromLeadFrequency = payload.leadFrequency?.warm || {}
  const coldFromLeadFrequency = payload.leadFrequency?.cold || {}
  const coldLegacy = payload.coldLead || {}

  const leadFollowUp = payload.leadFollowUp || {}
  payload.leadFollowUp = {
    warm: {
      enabled: leadFollowUp.warm?.enabled ?? true,
      maxAttempts:
        leadFollowUp.warm?.maxAttempts ??
        warmFromLeadFrequency.maxAttempts ??
        4,
      intervalsDays:
        leadFollowUp.warm?.intervalsDays ??
        warmFromLeadFrequency.intervalsDays ??
        [3, 7, 10, 14],
      ...(leadFollowUp.warm?.preset ? { preset: leadFollowUp.warm.preset } : {}),
    },
    cold: {
      enabled:
        leadFollowUp.cold?.enabled ??
        coldLegacy.enabled ??
        true,
      maxAttempts:
        leadFollowUp.cold?.maxAttempts ??
        coldLegacy.maxAttempts ??
        coldFromLeadFrequency.maxAttempts ??
        4,
      intervalsDays:
        leadFollowUp.cold?.intervalsDays ??
        coldLegacy.intervalsDays ??
        coldFromLeadFrequency.intervalsDays ??
        [7, 15, 30],
      ...(leadFollowUp.cold?.preset ? { preset: leadFollowUp.cold.preset } : {}),
    },
  }

  // Remove older/duplicate keys to keep one source of truth.
  delete payload.leadFrequency
  delete payload.coldLead

  // Accept legacy/FE string input like "1,3,7" for interval fields.
  if (payload.chatDropOff?.attemptIntervalsMinutes !== undefined) {
    payload.chatDropOff.attemptIntervalsMinutes = parseIntervalArray(payload.chatDropOff.attemptIntervalsMinutes)
  }
  if (payload.invoiceReminder?.intervalsHours !== undefined) {
    payload.invoiceReminder.intervalsHours = parseIntervalArray(payload.invoiceReminder.intervalsHours)
  }
  if (payload.leadFollowUp?.warm?.intervalsDays !== undefined) {
    payload.leadFollowUp.warm.intervalsDays = parseIntervalArray(payload.leadFollowUp.warm.intervalsDays)
  }
  if (payload.leadFollowUp?.cold?.intervalsDays !== undefined) {
    payload.leadFollowUp.cold.intervalsDays = parseIntervalArray(payload.leadFollowUp.cold.intervalsDays)
  }

  return payload
}

const validateAttemptConfig = (label, intervals, maxAttempts, requireExactCount = false) => {
  const max = Number(maxAttempts)
  if (!Number.isInteger(max) || max < 1 || max > MAX_ATTEMPTS_LIMIT) {
    return `${label}.maxAttempts must be an integer between 1 and ${MAX_ATTEMPTS_LIMIT}`
  }

  if (intervals === undefined) return null
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return `${label} intervals must be a non-empty array`
  }

  for (const value of intervals) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) {
      return `${label} intervals must contain only numbers greater than 0`
    }
  }

  if (requireExactCount && intervals.length !== max) {
    return `${label} intervals count (${intervals.length}) must exactly match maxAttempts (${max})`
  }

  if (!requireExactCount && intervals.length > max) {
    return `${label} intervals count (${intervals.length}) cannot exceed maxAttempts (${max})`
  }

  return null
}

const validateConfigPayload = (payload = {}, currentConfig = {}, rawPayload = {}) => {
  const errors = []

  const chatIntervalsProvided = rawPayload.chatDropOff?.attemptIntervalsMinutes !== undefined
  const chatTouched =
    rawPayload.chatDropOff?.attemptIntervalsMinutes !== undefined ||
    rawPayload.chatDropOff?.maxAttempts !== undefined
  const chatMaxAttempts =
    payload.chatDropOff?.maxAttempts ??
    currentConfig.chatDropOff?.maxAttempts
  if (chatTouched) {
    const err = validateAttemptConfig(
      'chatDropOff.attemptIntervalsMinutes',
      payload.chatDropOff?.attemptIntervalsMinutes,
      chatMaxAttempts,
      chatIntervalsProvided
    )
    if (err) errors.push(err)
  }

  const invoiceIntervalsProvided = rawPayload.invoiceReminder?.intervalsHours !== undefined
  const invoiceTouched =
    rawPayload.invoiceReminder?.intervalsHours !== undefined ||
    rawPayload.invoiceReminder?.maxAttempts !== undefined
  const invoiceMaxAttempts =
    payload.invoiceReminder?.maxAttempts ??
    currentConfig.invoiceReminder?.maxAttempts
  if (invoiceTouched) {
    const err = validateAttemptConfig(
      'invoiceReminder.intervalsHours',
      payload.invoiceReminder?.intervalsHours,
      invoiceMaxAttempts,
      invoiceIntervalsProvided
    )
    if (err) errors.push(err)
  }

  const warmIntervalsProvided =
    rawPayload.leadFollowUp?.warm?.intervalsDays !== undefined ||
    rawPayload.leadFrequency?.warm?.intervalsDays !== undefined
  const warmTouched =
    rawPayload.leadFollowUp?.warm !== undefined ||
    rawPayload.leadFrequency?.warm !== undefined
  if (warmTouched && payload.leadFollowUp?.warm) {
    const warmMaxAttempts =
      payload.leadFollowUp.warm?.maxAttempts ??
      currentConfig.leadFollowUp?.warm?.maxAttempts
    const err = validateAttemptConfig(
      'leadFollowUp.warm.intervalsDays',
      payload.leadFollowUp.warm?.intervalsDays,
      warmMaxAttempts,
      warmIntervalsProvided
    )
    if (err) errors.push(err)
  }

  const coldIntervalsProvided =
    rawPayload.leadFollowUp?.cold?.intervalsDays !== undefined ||
    rawPayload.coldLead?.intervalsDays !== undefined ||
    rawPayload.leadFrequency?.cold?.intervalsDays !== undefined
  const coldTouched =
    rawPayload.leadFollowUp?.cold !== undefined ||
    rawPayload.coldLead !== undefined ||
    rawPayload.leadFrequency?.cold !== undefined
  if (coldTouched && payload.leadFollowUp?.cold) {
    const coldMaxAttempts =
      payload.leadFollowUp.cold?.maxAttempts ??
      currentConfig.leadFollowUp?.cold?.maxAttempts
    const err = validateAttemptConfig(
      'leadFollowUp.cold.intervalsDays',
      payload.leadFollowUp.cold?.intervalsDays,
      coldMaxAttempts,
      coldIntervalsProvided
    )
    if (err) errors.push(err)
  }

  return errors
}

exports.getConfig = asyncHandler(async (req, res) => {
  const config = await getOrCreateConfig()
  return success(res, { config })
})

exports.updateConfig = asyncHandler(async (req, res) => {
  if (!['admin', 'sales'].includes(req.user.role)) {
    return forbidden(res, 'Only admin or sales can update automation config')
  }

  const payload = req.body || {}
  delete payload.key
  delete payload._id
  delete payload.createdAt
  delete payload.updatedAt
  const rawPayload = JSON.parse(JSON.stringify(payload))
  const currentConfig = await getOrCreateConfig()
  normalizeLeadFollowUpPayload(payload)
  const validationErrors = validateConfigPayload(payload, currentConfig, rawPayload)
  if (validationErrors.length) {
    return badRequest(res, validationErrors.join('; '))
  }

  await FollowUpAutomationConfig.findOneAndUpdate(
    { key: 'global' },
    { $set: { ...payload, updatedBy: req.user._id } },
    { upsert: true, new: true }
  )

  // Enforce internal business rules in a separate update to avoid
  // dot-path conflicts when payload includes chatDropOff object.
  const config = await FollowUpAutomationConfig.findOneAndUpdate(
    { key: 'global' },
    {
      $set: {
        'chatDropOff.requireNotQuoteReady': true,
        'chatDropOff.requireNotHandedToSales': true,
      },
    },
    { new: true }
  )

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_CONFIG_UPDATED,
    performedBy: req.user._id,
    metadata: { updates: payload },
  })

  return success(res, { config }, 'Follow-up automation config updated')
})

exports.runNow = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') return forbidden(res, 'Only admin can run automation sweep')
  const result = await runAutomationSweep()
  return success(res, result, 'Automation sweep completed')
})

exports.sendChatDropoffNow = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { message } = req.body || {}

  const lead = await Lead.findById(leadId).select('_id customerId assignedSales').lean()
  if (!lead) return notFound(res, 'Lead not found')

  if (req.user.role === 'sales' && String(lead.assignedSales || '') !== String(req.user._id)) {
    return forbidden(res, 'This lead is not assigned to you')
  }

  const customer = await Customer.findById(lead.customerId).lean()
  if (!customer) return notFound(res, 'Customer not found')

  const msg =
    String(message || '').trim() ||
    'Hi, we are following up regarding your chat. Share any pending details and we will help you complete your quote.'

  const smsTo = normalizePhone(customer.phone?.countryCode, customer.phone?.number)
  const emailTo = String(customer.email || '').trim().toLowerCase()
  if (!smsTo && !emailTo) return badRequest(res, 'Customer has no phone/email to send follow-up')

  const sent = { sms: false, email: false }
  const errors = {}
  if (smsTo) {
    try {
      await sendSms({ to: smsTo, body: msg })
      sent.sms = true
    } catch (err) {
      errors.sms = err.message || 'sms_failed'
    }
  }
  if (emailTo && isEmailConfigured()) {
    try {
      await sendFollowUpNudgeEmail({
        toEmail: emailTo,
        customerName: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || 'there',
        subject: 'Follow-up from Steel Building Depot',
        message: msg,
      })
      sent.email = true
    } catch (err) {
      errors.email = err.message || 'email_failed'
    }
  } else if (emailTo) {
    errors.email = 'email_not_configured'
  }

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_AUTO_SENT,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { kind: 'chat_dropoff_manual', sent, errors },
  })

  return success(res, { sent, errors }, 'Chat follow-up processed')
})
