const asyncHandler = require('../../utils/asyncHandler')
const { success, created, badRequest, notFound } = require('../../utils/apiResponse')
const svc = require('../../services/accountInvoiceManagement.service')

const sendExport = (res, result) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
  return res.send(result.buffer)
}

exports.getFilters = asyncHandler(async (req, res) => success(res, await svc.getFilters()))

exports.getProjectSummary = asyncHandler(async (req, res) => success(res, await svc.getProjectSummary(req.query)))
exports.listProjectRecords = asyncHandler(async (req, res) => success(res, await svc.listProjectRecords(req.query)))
exports.exportProjectRecords = asyncHandler(async (req, res) => sendExport(res, await svc.exportProjectRecords(req.query)))

exports.getVendorSummary = asyncHandler(async (req, res) => success(res, await svc.getVendorSummary(req.query)))
exports.listVendorRecords = asyncHandler(async (req, res) => success(res, await svc.listVendorRecords(req.query)))
exports.exportVendorRecords = asyncHandler(async (req, res) => sendExport(res, await svc.exportVendorRecords(req.query)))

exports.getCarrierSummary = asyncHandler(async (req, res) => success(res, await svc.getCarrierSummary(req.query)))
exports.listCarrierRecords = asyncHandler(async (req, res) => success(res, await svc.listCarrierRecords(req.query)))
exports.exportCarrierRecords = asyncHandler(async (req, res) => sendExport(res, await svc.exportCarrierRecords(req.query)))

exports.getMiscellaneousSummary = asyncHandler(async (req, res) =>
  success(res, await svc.getMiscellaneousSummary(req.query))
)
exports.listMiscellaneousRecords = asyncHandler(async (req, res) =>
  success(res, await svc.listMiscellaneousRecords(req.query))
)
exports.createMiscellaneousInvoice = asyncHandler(async (req, res) => {
  const result = await svc.createMiscellaneousInvoice(req.body, req.user._id)
  if (result.error) {
    return result.code === 404 ? notFound(res, result.error) : badRequest(res, result.error)
  }
  return created(res, result, 'Miscellaneous invoice created')
})
exports.exportMiscellaneousRecords = asyncHandler(async (req, res) =>
  sendExport(res, await svc.exportMiscellaneousRecords(req.query))
)

exports.getQuotationProfitSummary = asyncHandler(async (req, res) =>
  success(res, await svc.getQuotationProfitSummary(req.query))
)
exports.listQuotationProfitRecords = asyncHandler(async (req, res) =>
  success(res, await svc.listQuotationProfitRecords(req.query))
)
exports.uploadQuotationProfit = asyncHandler(async (req, res) => {
  const result = await svc.uploadQuotationProfit(req.body, req.user._id)
  if (result.error) {
    return result.code === 404 ? notFound(res, result.error) : badRequest(res, result.error)
  }
  return created(res, result, 'Quotation profit analysis saved')
})
exports.getQuotationProfitDetail = asyncHandler(async (req, res) => {
  const result = await svc.getQuotationProfitDetail(req.params.quotationId, req.query)
  if (result.error) return notFound(res, result.error)
  return success(res, result)
})
exports.exportQuotationProfitRecords = asyncHandler(async (req, res) =>
  sendExport(res, await svc.exportQuotationProfitRecords(req.query))
)
