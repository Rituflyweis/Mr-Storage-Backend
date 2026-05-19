const PaymentSchedule = require('../../models/PaymentSchedule')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.createSchedule = asyncHandler(async (req, res) => {
  const { leadId, stages } = req.body

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')
  const totalAmount = (req.body.totalAmount != null) ? req.body.totalAmount : lead.quoteValue

  const existing = await PaymentSchedule.findOne({ leadId })
  if (existing) return badRequest(res, 'Payment schedule already exists for this lead')

  const allPercentage = stages.every(s => s.amountType === 'percentage')
  const allFixed = stages.every(s => s.amountType === 'fixed')

  if (!allPercentage && !allFixed) {
    return badRequest(res, 'All stages must use the same amountType (percentage or fixed)')
  }

  const sum = stages.reduce((acc, s) => acc + s.amount, 0)

  if (allPercentage && Math.abs(sum - 100) > 0.01) {
    return badRequest(res, `Percentage stages must sum to 100. Got ${sum}`)
  }
  if (allFixed && Math.abs(sum - totalAmount) > 0.01) {
    return badRequest(res, `Fixed stages must sum to totalAmount (${totalAmount}). Got ${sum}`)
  }

  const schedule = await PaymentSchedule.create({
    leadId,
    customerId: lead.customerId,
    stages,
    totalAmount,
    createdBy: req.user._id,
  })

  return created(res, { schedule })
})

exports.getScheduleByLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const schedule = await PaymentSchedule.findOne({ leadId }).lean()
  return success(res, { schedule: schedule || null })
})
