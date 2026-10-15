const adminFinancial = require('../admin/financial.controller')
const marginService = require('../../services/accountMarginAnalysis.service')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getMarginFilters = asyncHandler(async (req, res) => {
  const data = await marginService.getMarginFilters()
  return success(res, data)
})

exports.getMarginAnalysis = asyncHandler(async (req, res) => {
  const data = await marginService.getMarginAnalysisSummary(req.query)
  return success(res, data)
})

exports.getMarginTrend = asyncHandler(async (req, res) => {
  const data = await marginService.getMarginTrendOverTime(req.query)
  if (data.error) return badRequest(res, data.error)
  return success(res, data)
})

exports.getMarginByProjects = asyncHandler(async (req, res) => {
  const data = await marginService.getMarginByProjects(req.query)
  return success(res, data)
})

exports.getProfitLossSummary = asyncHandler(async (req, res) => {
  const data = await marginService.getProfitLossSummaryTable(req.query)
  return success(res, data)
})

exports.getProfitLossDetail = asyncHandler(async (req, res) => {
  req.query.projectId = req.query.projectId || req.query.leadId
  return adminFinancial.getProfitLoss(req, res)
})

exports.exportProfitLoss = asyncHandler(async (req, res) => {
  return adminFinancial.exportProfitLoss(req, res)
})

exports.getBudgetVsActual = asyncHandler(async (req, res) => {
  return adminFinancial.getBudgetVsActual(req, res)
})
