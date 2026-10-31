const { getWorkflowStatus } = require('../controllers/common/quotation.controller')

/** Same shape as GET /api/sales/estimates/:id → estimate.conversion */
const buildEstimateConversionMeta = (quotation) => {
  if (!quotation) {
    return {
      isConvertedToQuotation: false,
      quotationId: null,
      quoteNumber: null,
      quotationStatus: null,
      approvalStatus: null,
      workflowStatus: null,
      versionNumber: null,
      convertedAt: null,
    }
  }
  const approvalStatus = quotation.approval?.status || 'not_submitted'
  return {
    isConvertedToQuotation: true,
    quotationId: quotation._id,
    quoteNumber: quotation.quoteNumber || null,
    quotationStatus: quotation.status || 'draft',
    approvalStatus,
    workflowStatus: getWorkflowStatus(quotation),
    versionNumber: quotation.versionNumber || 1,
    convertedAt: quotation.createdAt || null,
  }
}

const QUOTATION_LINK_SELECT =
  '_id quoteNumber status approval createdAt versionNumber sourceEstimateId sourceCustomQuoteId'

module.exports = {
  buildEstimateConversionMeta,
  QUOTATION_LINK_SELECT,
}
