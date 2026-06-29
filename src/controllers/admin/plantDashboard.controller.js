const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const {
  buildOrderProgressReview,
  buildLoadPlanningStatus,
  buildShipperQuotationSummary,
  buildPackingListSummary,
  buildQrLabelsSummary,
  buildShippersSummary,
  buildDeliveriesSummary,
  buildUpcomingShipments,
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
