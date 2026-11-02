const PaymentSchedule = require('../../models/PaymentSchedule')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const {
  ensurePaymentScheduleFromEstimate,
  suggestPaymentStagesFromEstimate,
} = require('../../services/paymentScheduleFromEstimate.service')

const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

const stageAmountSum = (stages = []) =>
  stages.reduce((acc, s) => acc + Number(s.amount || 0), 0)

/** Same $1 cap as quote milestone engine — pct rows rounded to $ can overshoot contract by 1. */
const PAYMENT_STAGE_PENNY_TOLERANCE = 1

const normalizeFixedStageTotals = (stages = [], totalAmount) => {
  const allFixed = stages.length && stages.every((s) => s.amountType === 'fixed')
  if (!allFixed) return stages
  const target = Math.round(Number(totalAmount) || 0)
  if (target <= 0) return stages
  const sum = stageAmountSum(stages)
  const drift = Math.round(target - sum)
  if (drift === 0 || Math.abs(drift) > PAYMENT_STAGE_PENNY_TOLERANCE) return stages
  const next = stages.map((s) => ({ ...s }))
  const last = next[next.length - 1]
  last.amount = Math.max(0, Math.round(Number(last.amount) + drift))
  return next
}

const validateStages = (stages, totalAmount) => {
  const allPercentage = stages.every(s => s.amountType === 'percentage')
  const allFixed = stages.every(s => s.amountType === 'fixed')

  if (!allPercentage && !allFixed) {
    return { error: 'All stages must use the same amountType (percentage or fixed)' }
  }

  const sum = stageAmountSum(stages)

  if (allPercentage && Math.abs(sum - 100) > 0.01) {
    return { error: `Percentage stages must sum to 100. Got ${sum}` }
  }
  if (
    allFixed &&
    Math.abs(sum - totalAmount) > PAYMENT_STAGE_PENNY_TOLERANCE
  ) {
    return {
      error: `Fixed stages must sum to totalAmount (${totalAmount}). Got ${sum}`,
    }
  }

  return { allPercentage, allFixed, sum }
}

/** Fixed $ milestones: totalAmount is always sum(stages) — not tax-inclusive invoice total. */
const resolveScheduleTotalAmount = (stages, requestedTotal) => {
  const allFixed = stages.every((s) => s.amountType === 'fixed')
  const sum = stageAmountSum(stages)
  if (allFixed) return sum
  if (requestedTotal != null && requestedTotal !== '') return Number(requestedTotal)
  return sum
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
  const contractGrand =
    req.body.contractGrand != null
      ? Math.round(Number(req.body.contractGrand))
      : req.body.grandTotal != null
        ? Math.round(Number(req.body.grandTotal))
        : null
  const totalAmount = resolveScheduleTotalAmount(
    stages,
    contractGrand ?? req.body.totalAmount ?? lead.quoteValue,
  )
  const normalizedStages = normalizeFixedStageTotals(stages, totalAmount)

  const existing = await PaymentSchedule.findOne({ leadId })
  if (existing) return badRequest(res, 'Payment schedule already exists for this lead')

  const stageValidation = validateStages(normalizedStages, totalAmount)
  if (stageValidation.error) return badRequest(res, stageValidation.error)

  const schedule = await PaymentSchedule.create({
    leadId,
    customerId: lead.customerId,
    stages: normalizedStages,
    totalAmount,
    createdBy: req.user._id,
  })

  return created(res, { schedule })
})

exports.getScheduleByLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lead, error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  let schedule = await PaymentSchedule.findOne({ leadId }).lean()
  let seededFromQuote = false
  const refreshFromQuote =
    req.query.refreshFromQuote === 'true' || req.query.syncMilestones === 'true'

  if (!schedule || !Array.isArray(schedule.stages) || !schedule.stages.length) {
    const seeded = await ensurePaymentScheduleFromEstimate({
      lead,
      userId: req.user._id,
      quotationId: req.query.quotationId || null,
    })
    if (seeded.schedule) {
      schedule =
        typeof seeded.schedule.toObject === 'function'
          ? seeded.schedule.toObject()
          : seeded.schedule
      seededFromQuote = Boolean(seeded.seeded)
    }
  } else if (refreshFromQuote) {
    const seeded = await ensurePaymentScheduleFromEstimate({
      lead,
      userId: req.user._id,
      quotationId: req.query.quotationId || null,
      force: true,
    })
    if (seeded.seeded && seeded.schedule) {
      schedule =
        typeof seeded.schedule.toObject === 'function'
          ? seeded.schedule.toObject()
          : seeded.schedule
      seededFromQuote = true
    }
  } else if (schedule?.stages?.length) {
    const quoteSuggested = await suggestPaymentStagesFromEstimate(
      leadId,
      req.query.quotationId || null,
    )
    const storedTotal = Number(schedule.totalAmount || stageAmountSum(schedule.stages))
    const quoteTotal = Number(quoteSuggested.totalAmount || 0)
    const outOfSync =
      quoteSuggested.stages?.length > 0 &&
      quoteTotal > 0 &&
      Math.abs(storedTotal - quoteTotal) > 0.01
    if (outOfSync) {
      const seeded = await ensurePaymentScheduleFromEstimate({
        lead,
        userId: req.user._id,
        quotationId: quoteSuggested.quotationId || req.query.quotationId || null,
        force: true,
      })
      if (seeded.seeded && seeded.schedule) {
        schedule =
          typeof seeded.schedule.toObject === 'function'
            ? seeded.schedule.toObject()
            : seeded.schedule
        seededFromQuote = true
      }
    }
  }
  const quoteMilestoneSuggested = await suggestPaymentStagesFromEstimate(
    leadId,
    req.query.quotationId || null,
  )
  const scheduleTotal = schedule
    ? Number(schedule.totalAmount || stageAmountSum(schedule.stages || []))
    : 0
  const quoteMilestoneTotal = Number(quoteMilestoneSuggested.totalAmount || 0)
  const paymentScheduleOutOfSync =
    Boolean(schedule?.stages?.length) &&
    quoteMilestoneSuggested.stages?.length > 0 &&
    quoteMilestoneTotal > 0 &&
    Math.abs(scheduleTotal - quoteMilestoneTotal) > 0.01

  return success(res, {
    schedule: schedule || null,
    seededFromQuote,
    paymentScheduleOutOfSync,
    quoteMilestoneStages: quoteMilestoneSuggested.stages || [],
    quoteMilestoneTotal,
  })
})

exports.updateScheduleByLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { stages } = req.body

  const { lead, error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const schedule = await PaymentSchedule.findOne({ leadId })
  if (!schedule) return notFound(res, 'Payment schedule not found for this lead')

  const contractGrand =
    req.body.contractGrand != null
      ? Math.round(Number(req.body.contractGrand))
      : req.body.grandTotal != null
        ? Math.round(Number(req.body.grandTotal))
        : null
  const totalAmount = resolveScheduleTotalAmount(
    stages,
    contractGrand ??
      (req.body.totalAmount != null ? req.body.totalAmount : schedule.totalAmount),
  )
  const normalizedStages = normalizeFixedStageTotals(stages, totalAmount)
  const stageValidation = validateStages(normalizedStages, totalAmount)
  if (stageValidation.error) return badRequest(res, stageValidation.error)

  const mergeResult = mergePaymentScheduleStages(schedule.stages, normalizedStages)
  if (mergeResult.error) return badRequest(res, mergeResult.error)

  schedule.totalAmount = totalAmount
  schedule.stages = mergeResult.stages
  await schedule.save()

  await auditService.log({
    type: 'payment',
    action: AUDIT_ACTIONS.PAYMENT_SCHEDULE_UPDATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { scheduleId: schedule._id, stageCount: schedule.stages.length },
  })

  return success(res, { schedule }, 'Payment schedule updated')
})
