const EstimateQuote = require('../../models/EstimateQuote')
const Quotation = require('../../models/Quotation')
const { saveEstimateQuoteWithRetry } = require('../../utils/saveEstimateQuoteWithRetry')

/**
 * Estimate may move to `final` when the sales quotation is locked for contract work:
 * customer accepted, sent to client, or admin-approved (sales UI "Approved").
 */
const quotationQualifiesForEstimateFinalize = (quotation) => {
  if (!quotation) return false
  const docStatus = quotation.status || 'draft'
  if (docStatus === 'accepted' || docStatus === 'sent') return true
  if (docStatus === 'rejected') return false
  const approvalStatus = quotation.approval?.status || 'not_submitted'
  return approvalStatus === 'approved'
}

const finalizeLinkedEstimateIfDraft = async (quotation = {}) => {
  const estimateId = quotation.sourceEstimateId
  if (!estimateId) {
    return { finalized: false, reason: 'no_source_estimate' }
  }
  const estimate = await EstimateQuote.findById(estimateId)
  if (!estimate) {
    return { finalized: false, reason: 'estimate_not_found', estimateId: String(estimateId) }
  }
  if (estimate.status === 'final') {
    return {
      finalized: false,
      reason: 'already_final',
      estimateId: String(estimate._id),
      estimateStatus: 'final',
    }
  }
  if (estimate.status !== 'draft') {
    return {
      finalized: false,
      reason: 'not_draft',
      estimateId: String(estimate._id),
      estimateStatus: estimate.status,
    }
  }
  estimate.status = 'final'
  await saveEstimateQuoteWithRetry(estimate)
  return {
    finalized: true,
    estimateId: String(estimate._id),
    estimateStatus: 'final',
  }
}

/** Used before change orders — auto-finalize when linked quotation qualifies (incl. admin approved). */
const ensureEstimateFinalForChangeOrders = async (estimateId) => {
  if (!estimateId) return { error: 'estimateId is required', code: 400 }
  let estimate = await EstimateQuote.findById(estimateId)
  if (!estimate) return { error: 'Estimate not found', code: 404 }
  if (estimate.status === 'final') return { est: estimate }

  const quotation = await Quotation.findOne({ sourceEstimateId: estimate._id })
    .sort({ createdAt: -1 })
    .lean()

  if (!quotationQualifiesForEstimateFinalize(quotation)) {
    return {
      error:
        'Change orders are only allowed after the estimate is final (client contract issued). Edit the draft quote to change price instead.',
      code: 400,
      estimateStatus: estimate.status,
      estimateId: String(estimate._id),
      quotationStatus: quotation?.status || null,
      approvalStatus: quotation?.approval?.status || null,
    }
  }

  await finalizeLinkedEstimateIfDraft(quotation)
  estimate = await EstimateQuote.findById(estimateId)
  if (!estimate || estimate.status !== 'final') {
    return {
      error: 'Could not finalize estimate for change orders',
      code: 400,
      estimateStatus: estimate?.status || 'draft',
      estimateId: String(estimateId),
    }
  }
  return { est: estimate }
}

module.exports = {
  finalizeLinkedEstimateIfDraft,
  quotationQualifiesForEstimateFinalize,
  ensureEstimateFinalForChangeOrders,
}
