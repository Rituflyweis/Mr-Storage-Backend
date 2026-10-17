const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound } = require('../../utils/apiResponse')
const svc = require('../../services/accountProjectSubpages.service')

const handle = async (res, result) => {
  if (result?.error) {
    return result.code === 404 ? notFound(res, result.error) : notFound(res, result.error)
  }
  return success(res, result)
}

exports.getInvoicesSummary = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectInvoicesSummary(req.params.projectId, req.query))
)
exports.listInvoices = asyncHandler(async (req, res) =>
  handle(res, await svc.listProjectInvoices(req.params.projectId, req.query))
)

exports.getPaymentsSummary = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectPaymentsSummary(req.params.projectId))
)
exports.listPayments = asyncHandler(async (req, res) =>
  handle(res, await svc.listProjectPayments(req.params.projectId, req.query))
)

exports.listDeliveries = asyncHandler(async (req, res) =>
  handle(res, await svc.listProjectDeliveries(req.params.projectId, req.query))
)
exports.getFinalDelivery = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectFinalDelivery(req.params.projectId))
)
exports.getDeliveryDetail = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectDeliveryDetail(req.params.projectId, req.params.deliveryId))
)

exports.listQuotations = asyncHandler(async (req, res) =>
  handle(res, await svc.listProjectQuotations(req.params.projectId, req.query))
)
exports.getQuotationDetail = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectQuotationDetail(req.params.projectId, req.params.quotationId))
)

exports.getBom = asyncHandler(async (req, res) => handle(res, await svc.getProjectBom(req.params.projectId)))
exports.getConsolidatedBom = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectConsolidatedBom(req.params.projectId))
)
exports.getAgreement = asyncHandler(async (req, res) =>
  handle(res, await svc.getProjectAgreement(req.params.projectId))
)
