const PaymentSchedule = require('../../models/PaymentSchedule')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

const validateStages = (stages, totalAmount) => {
  const allPercentage = stages.every(s => s.amountType === 'percentage')
  const allFixed = stages.every(s => s.amountType === 'fixed')

  if (!allPercentage && !allFixed) {
    return { error: 'All stages must use the same amountType (percentage or fixed)' }
  }

  const sum = stages.reduce((acc, s) => acc + s.amount, 0)

  if (allPercentage && Math.abs(sum - 100) > 0.01) {
    return { error: `Percentage stages must sum to 100. Got ${sum}` }
  }
  if (allFixed && Math.abs(sum - totalAmount) > 0.01) {
    return { error: `Fixed stages must sum to totalAmount (${totalAmount}). Got ${sum}` }
  }

  return { allPercentage, allFixed }
}

const mergePaymentScheduleStages = (existingStages, incomingStages) => {
  const existingById = new Map(existingStages.map(s => [String(s._id), s]))
  const incomingIds = new Set(
    incomingStages.filter(s => s._id).map(s => String(s._id))
  )

  for (const prev of existingStages) {
    if (incomingIds.has(String(prev._id))) continue
    if (prev.invoiceId || ['invoiced', 'paid', 'overdue'].includes(prev.status)) {
      return {
        error: `Cannot remove stage "${prev.stageName}" while it is linked to an invoice or no longer pending`,
      }
    }
  }

  const merged = incomingStages.map((incoming) => {
    const prev = incoming._id ? existingById.get(String(incoming._id)) : null
    if (prev) {
      return {
        _id: prev._id,
        stageName: incoming.stageName,
        amount: incoming.amount,
        amountType: incoming.amountType,
        dueDate: incoming.dueDate ?? prev.dueDate ?? null,
        status: prev.status,
        invoiceId: prev.invoiceId ?? null,
        paidAt: prev.paidAt ?? null,
        paidBy: prev.paidBy ?? null,
      }
    }

    return {
      stageName: incoming.stageName,
      amount: incoming.amount,
      amountType: incoming.amountType,
      dueDate: incoming.dueDate ?? null,
      status: 'pending',
      invoiceId: null,
      paidAt: null,
      paidBy: null,
    }
  })

  return { stages: merged }
}

exports.createSchedule = asyncHandler(async (req, res) => {
  const { leadId, stages } = req.body

  const { lead, error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)
  const totalAmount = (req.body.totalAmount != null) ? req.body.totalAmount : lead.quoteValue

  const existing = await PaymentSchedule.findOne({ leadId })
  if (existing) return badRequest(res, 'Payment schedule already exists for this lead')

  const stageValidation = validateStages(stages, totalAmount)
  if (stageValidation.error) return badRequest(res, stageValidation.error)

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
  const { error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const schedule = await PaymentSchedule.findOne({ leadId }).lean()
  return success(res, { schedule: schedule || null })
})

exports.updateScheduleByLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { stages } = req.body

  const { lead, error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const schedule = await PaymentSchedule.findOne({ leadId })
  if (!schedule) return notFound(res, 'Payment schedule not found for this lead')

  const totalAmount = req.body.totalAmount != null ? req.body.totalAmount : schedule.totalAmount
  const stageValidation = validateStages(stages, totalAmount)
  if (stageValidation.error) return badRequest(res, stageValidation.error)

  const mergeResult = mergePaymentScheduleStages(schedule.stages, stages)
  if (mergeResult.error) return badRequest(res, mergeResult.error)

  schedule.totalAmount = totalAmount
  schedule.stages = mergeResult.stages
  await schedule.save()

  await auditService.log({
    type: 'payment',
    action: 'payment.schedule_updated',
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { scheduleId: schedule._id, stageCount: schedule.stages.length },
  })

  return success(res, { schedule }, 'Payment schedule updated')
})
