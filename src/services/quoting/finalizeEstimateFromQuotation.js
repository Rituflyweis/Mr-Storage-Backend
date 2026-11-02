const EstimateQuote = require('../../models/EstimateQuote')
const { saveEstimateQuoteWithRetry } = require('../../utils/saveEstimateQuoteWithRetry')

/**
 * Customer acceptance = contract agreed → lock linked COG estimate for change orders.
 */
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

module.exports = { finalizeLinkedEstimateIfDraft }
