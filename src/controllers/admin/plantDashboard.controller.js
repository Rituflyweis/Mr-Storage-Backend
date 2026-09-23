const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { generatePlantOverviewExcel } = require('../../utils/exportPlantDashboard')
const {
  buildOrderProgressReview,
  buildLoadPlanningStatus,
  buildShipperQuotationSummary,
  buildPackingListSummary,
  buildQrLabelsSummary,
  buildShippersSummary,
  buildDeliveriesSummary,
  buildUpcomingShipments,
  buildMismatchSummary,
  buildMismatchReport,
  buildPlantOverviewExportPayload,
} = require('../../services/admin/plantDashboard.service')

exports.getOrderProgressReview = asyncHandler(async (req, res) => {
  const data = await buildOrderProgressReview(req.query)
  return success(res, data)
})

exports.getLoadPlanningStatus = asyncHandler(async (req, res) => {
  const data = await buildLoadPlanningStatus(req.query)
  return success(res, data)
})

exports.getShipperQuotationSummary = asyncHandler(async (req, res) => {
  const data = await buildShipperQuotationSummary(req.query)
  return success(res, data)
})

exports.getPackingListSummary = asyncHandler(async (req, res) => {
  const data = await buildPackingListSummary(req.query)
  return success(res, data)
})

exports.getQrLabelsSummary = asyncHandler(async (req, res) => {
  const data = await buildQrLabelsSummary(req.query)
  return success(res, data)
})

exports.getShippersSummary = asyncHandler(async (req, res) => {
  const data = await buildShippersSummary(req.query)
  return success(res, data)
})

exports.getDeliveriesSummary = asyncHandler(async (req, res) => {
  const data = await buildDeliveriesSummary(req.query)
  return success(res, data)
})

exports.getUpcomingShipments = asyncHandler(async (req, res) => {
  const data = await buildUpcomingShipments(req.query)
  return success(res, data)
})

exports.getMismatchSummary = asyncHandler(async (req, res) => {
  const data = await buildMismatchSummary(req.query)
  return success(res, data)
})

exports.getMismatchReport = asyncHandler(async (req, res) => {
  const data = await buildMismatchReport(req.query)
  return success(res, data)
})

exports.exportPlantOverview = asyncHandler(async (req, res) => {
  const payload = await buildPlantOverviewExportPayload(req.query)
  const buffer = await generatePlantOverviewExcel(payload)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="plant-overview.xlsx"')
  return res.send(buffer)
})
