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

const normalizePhone = (countryCode, phone) => {
  const cc = String(countryCode || '').trim()
  const pn = String(phone || '').trim().replace(/\s+/g, '')
  const raw = `${cc}${pn}`
  if (!raw) return ''
  if (raw.startsWith('+')) return raw
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? `+${digits}` : ''
}

exports.getConfig = asyncHandler(async (req, res) => {
  const config = await getOrCreateConfig()
  return success(res, { config })
})

exports.updateConfig = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') return forbidden(res, 'Only admin can update automation config')

  const payload = req.body || {}
  delete payload.key
  delete payload._id
  delete payload.createdAt
  delete payload.updatedAt

  const config = await FollowUpAutomationConfig.findOneAndUpdate(
    { key: 'global' },
    { $set: { ...payload, updatedBy: req.user._id } },
    { upsert: true, new: true }
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
        subject: 'Follow-up from Storage Materials',
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
