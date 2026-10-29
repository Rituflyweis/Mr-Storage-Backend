/**
 * Seed lead PaymentSchedule from EstimateQuote milestoneSchedule / depositTerms
 * (same source as quote preview Milestone Payment Schedule).
 */

const Quotation = require('../models/Quotation')
const EstimateQuote = require('../models/EstimateQuote')
const PaymentSchedule = require('../models/PaymentSchedule')
const {
  computeMilestones,
  depositTermsToMilestoneRows,
} = require('./quoting/depositMilestoneEngine')

const grandOfEstimate = (est = {}) =>
  Number(
    est.revisedContractTotal ??
      est.fullQuoteResult?.grandTotal ??
      est.totalSell ??
      est.pricingResult?.totSell ??
      est.storagePricingResult?.grandTotal ??
      0,
  ) || 0

const resolveMilestoneRowsFromEstimate = (est = {}) => {
  const grand = grandOfEstimate(est)
  const rows =
    Array.isArray(est.milestoneSchedule) && est.milestoneSchedule.length
      ? est.milestoneSchedule
      : depositTermsToMilestoneRows(est.depositTerms, grand)
  if (!rows.length || !grand) return null
  return computeMilestones({ grand, rows })
}

/** Prefer fixed $ so mixed pct/fixed quote rows pass PaymentSchedule validateStages. */
const milestoneRowsToPaymentStages = (computed) => {
  const stages = (computed.rows || []).map((r) => ({
    stageName: String(r.label || 'Milestone').trim() || 'Milestone',
    amount: Math.round(Number(r.amount) || 0),
    amountType: 'fixed',
    dueDate: null,
    status: 'pending',
  }))
  const totalAmount = stages.reduce((s, r) => s + r.amount, 0)
  return {
    totalAmount: totalAmount || Math.round(Number(computed.grand) || 0),
    stages,
  }
}

const findQuotationForLead = async (leadId, explicitQuotationId = null) => {
  if (explicitQuotationId) {
    const q = await Quotation.findOne({ _id: explicitQuotationId, leadId }).lean()
    if (q) return q
  }
  return (
    (await Quotation.findOne({ leadId, 'approval.status': 'approved' })
      .sort({ 'approval.reviewedAt': -1, createdAt: -1 })
      .lean()) ||
    (await Quotation.findOne({ leadId, status: 'sent' })
      .sort({ sentAt: -1, createdAt: -1 })
      .lean()) ||
    (await Quotation.findOne({ leadId, status: 'accepted' })
      .sort({ createdAt: -1 })
      .lean()) ||
    (await Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean())
  )
}

const loadEstimateMilestones = async (quotation) => {
  if (!quotation?.sourceEstimateId) return null
  const est = await EstimateQuote.findById(quotation.sourceEstimateId)
    .select(
      'milestoneSchedule depositTerms revisedContractTotal fullQuoteResult totalSell pricingResult storagePricingResult',
    )
    .lean()
  if (!est) return null
  return resolveMilestoneRowsFromEstimate(est)
}

/**
 * Create PaymentSchedule from quote milestones when the lead has none yet.
 * Does not overwrite an existing schedule (manual edits / invoiced stages).
 */
const ensurePaymentScheduleFromEstimate = async ({
  lead,
  userId,
  quotationId = null,
  force = false,
} = {}) => {
  if (!lead?._id || !lead.customerId) return { schedule: null, seeded: false, reason: 'no_lead' }

  const existing = await PaymentSchedule.findOne({ leadId: lead._id })
  if (existing && !force) {
    return { schedule: existing, seeded: false, reason: 'already_exists' }
  }
  if (existing && force) {
    const locked = (existing.stages || []).some(
      (s) => s.invoiceId || ['invoiced', 'paid', 'overdue'].includes(s.status),
    )
    if (locked) {
      return { schedule: existing, seeded: false, reason: 'stages_locked' }
    }
  }

  const quotation = await findQuotationForLead(lead._id, quotationId)
  if (!quotation) return { schedule: existing || null, seeded: false, reason: 'no_quotation' }

  const computed = await loadEstimateMilestones(quotation)
  if (!computed?.rows?.length) {
    return { schedule: existing || null, seeded: false, reason: 'no_milestones' }
  }

  const { totalAmount, stages } = milestoneRowsToPaymentStages(computed)
  if (!stages.length || !totalAmount) {
    return { schedule: existing || null, seeded: false, reason: 'empty_stages' }
  }

  if (existing && force) {
    existing.stages = stages
    existing.totalAmount = totalAmount
    await existing.save()
    return { schedule: existing, seeded: true, reason: 'updated', quotationId: quotation._id }
  }

  const schedule = await PaymentSchedule.create({
    leadId: lead._id,
    customerId: lead.customerId,
    stages,
    totalAmount,
    createdBy: userId,
  })

  return { schedule, seeded: true, reason: 'created', quotationId: quotation._id }
}

/** Suggested stages for invoice form prefill (no DB write). */
const suggestPaymentStagesFromEstimate = async (leadId, quotationId = null) => {
  const quotation = await findQuotationForLead(leadId, quotationId)
  if (!quotation) return { stages: [], totalAmount: 0, quotationId: null }
  const computed = await loadEstimateMilestones(quotation)
  if (!computed?.rows?.length) {
    return { stages: [], totalAmount: 0, quotationId: quotation._id }
  }
  const mapped = milestoneRowsToPaymentStages(computed)
  return { ...mapped, quotationId: quotation._id }
}

module.exports = {
  grandOfEstimate,
  resolveMilestoneRowsFromEstimate,
  milestoneRowsToPaymentStages,
  ensurePaymentScheduleFromEstimate,
  suggestPaymentStagesFromEstimate,
}
