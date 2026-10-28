const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const dash = require('../../services/admin/adminDashboard.service')

// Keep legacy endpoints working (thin wrappers)
exports.getLeadStats = asyncHandler(async (req, res) => {
  const data = await dash.getKpis(req.query)
  return success(res, data, 'Lead stats')
})

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const data = await dash.getReportsOverview(req.query)
  return success(
    res,
    {
      total: data.customers,
      active: data.customers,
      newThisMonth: data.customers,
      returning: 0,
    },
    'Customer stats',
  )
})

exports.getAiVsHuman = asyncHandler(async (req, res) => {
  const data = await dash.getQueryHandling(req.query)
  return success(res, { withAi: data.withAi, withSales: data.withSales }, 'AI vs human')
})

exports.getPerformanceTrend = asyncHandler(async (req, res) => {
  const reports = await dash.getReportsOverview(req.query)
  return success(
    res,
    {
      data: reports.weeklySeries.map((d) => ({
        date: d.date,
        value: req.query.tab === 'revenue' ? d.revenue : d.revenue,
      })),
      percentageChange: 0,
      rangeLabel: req.query.range || '7d',
    },
    'Performance trend',
  )
})

/** Full Admin Dashboard Figma payload */
exports.getOverview = asyncHandler(async (req, res) => {
  const data = await dash.getOverview(req.query)
  return success(res, data, 'Admin dashboard overview')
})

exports.getKpis = asyncHandler(async (req, res) => {
  return success(res, await dash.getKpis(req.query), 'Dashboard KPIs')
})
exports.getDeliveryFinance = asyncHandler(async (req, res) => {
  return success(res, await dash.getDeliveryFinance(req.query), 'Delivery finance')
})
exports.getLoadOptimization = asyncHandler(async (req, res) => {
  return success(res, await dash.getLoadOptimization(req.query), 'Load optimization')
})
exports.getDeliveryOperations = asyncHandler(async (req, res) => {
  return success(res, await dash.getDeliveryOperations(req.query), 'Delivery operations')
})
exports.getCommunicationStatus = asyncHandler(async (req, res) => {
  return success(res, await dash.getCommunicationStatus(req.query), 'Communication status')
})
exports.getFreightActivity = asyncHandler(async (req, res) => {
  return success(res, await dash.getFreightActivity(req.query), 'Freight activity')
})
exports.getConversionFunnel = asyncHandler(async (req, res) => {
  return success(res, await dash.getConversionFunnel(req.query), 'Conversion funnel')
})
exports.getDealSizeDistribution = asyncHandler(async (req, res) => {
  return success(res, await dash.getDealSizeDistribution(req.query), 'Deal size distribution')
})
exports.getReportsOverview = asyncHandler(async (req, res) => {
  return success(res, await dash.getReportsOverview(req.query), 'Reports overview')
})
exports.getLeadSources = asyncHandler(async (req, res) => {
  return success(res, await dash.getLeadSources(req.query), 'Lead sources')
})
exports.getDispatchReadiness = asyncHandler(async (req, res) => {
  return success(res, await dash.getDispatchReadiness(req.query), 'Dispatch readiness')
})
exports.getLeadConversion = asyncHandler(async (req, res) => {
  return success(res, await dash.getLeadConversion(req.query), 'Lead conversion')
})
exports.getTonnageSold = asyncHandler(async (req, res) => {
  return success(res, await dash.getTonnageSold(req.query), 'Tonnage sold')
})
exports.getOpsKpis = asyncHandler(async (req, res) => {
  return success(res, await dash.getOpsKpis(req.query), 'Ops KPIs')
})
exports.getPipelineStageOverview = asyncHandler(async (req, res) => {
  return success(res, await dash.getPipelineStageOverview(req.query), 'Pipeline stages')
})
exports.getQueryHandling = asyncHandler(async (req, res) => {
  return success(res, await dash.getQueryHandling(req.query), 'Query handling')
})
exports.getPipelineKanban = asyncHandler(async (req, res) => {
  return success(res, await dash.getPipelineKanban(req.query, req.query.limit), 'Pipeline kanban')
})
exports.getRecentClosedDeals = asyncHandler(async (req, res) => {
  return success(res, await dash.getRecentClosedDeals(req.query, req.query.limit), 'Recent closed deals')
})
exports.getSalesActivity = asyncHandler(async (req, res) => {
  return success(res, await dash.getSalesActivity(req.query, req.query.limit), 'Sales activity')
})
exports.getTopPerformers = asyncHandler(async (req, res) => {
  return success(res, await dash.getTopPerformers(req.query, req.query.limit), 'Top performers')
})
exports.getTaxSummary = asyncHandler(async (req, res) => {
  return success(res, await dash.getTaxSummary(req.query), 'Tax summary')
})
exports.getTaxByState = asyncHandler(async (req, res) => {
  return success(res, await dash.getTaxByState(req.query), 'Tax by state')
})
exports.getTaxByBuildingType = asyncHandler(async (req, res) => {
  return success(res, await dash.getTaxByBuildingType(req.query), 'Tax by building type')
})
exports.getConstructionProgress = asyncHandler(async (req, res) => {
  return success(res, await dash.getConstructionProgress(req.query, req.query.limit), 'Construction progress')
})
exports.getPlantProduction = asyncHandler(async (req, res) => {
  return success(res, await dash.getPlantProduction(req.query), 'Plant production')
})
exports.getBusinessHighlights = asyncHandler(async (req, res) => {
  return success(res, await dash.getBusinessHighlights(req.query), 'Business highlights')
})
exports.getCustomerApprovals = asyncHandler(async (req, res) => {
  return success(res, await dash.getCustomerApprovals(req.query, req.query.limit), 'Customer approvals')
})
exports.getSalesMix = asyncHandler(async (req, res) => {
  return success(res, await dash.getSalesMix(req.query), 'Sales mix')
})

exports.searchGlobal = asyncHandler(async (req, res) => {
  const q = req.query.q || req.query.search || ''
  if (!String(q).trim()) return badRequest(res, 'q (search text) is required')
  return success(res, await dash.searchGlobal(q, req.query.limit), 'Search results')
})
