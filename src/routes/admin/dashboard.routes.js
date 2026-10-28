const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/admin/dashboard.controller')

const periodQuery = [
  query('period').optional().isIn(['today', 'week', 'month', 'all']),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
]

// Legacy (kept)
router.get('/lead-stats', periodQuery, validate, ctrl.getLeadStats)
router.get('/customer-stats', periodQuery, validate, ctrl.getCustomerStats)
router.get('/ai-vs-human', periodQuery, validate, ctrl.getAiVsHuman)
router.get('/performance-trend', periodQuery, validate, ctrl.getPerformanceTrend)

// Figma Admin Dashboard — full + section endpoints
router.get('/overview', periodQuery, validate, ctrl.getOverview)
router.get('/kpis', periodQuery, validate, ctrl.getKpis)
router.get('/delivery-finance', periodQuery, validate, ctrl.getDeliveryFinance)
router.get('/load-optimization', periodQuery, validate, ctrl.getLoadOptimization)
router.get('/delivery-operations', periodQuery, validate, ctrl.getDeliveryOperations)
router.get('/communication-status', periodQuery, validate, ctrl.getCommunicationStatus)
router.get('/freight-activity', periodQuery, validate, ctrl.getFreightActivity)
router.get('/conversion-funnel', periodQuery, validate, ctrl.getConversionFunnel)
router.get('/deal-size-distribution', periodQuery, validate, ctrl.getDealSizeDistribution)
router.get('/reports-overview', periodQuery, validate, ctrl.getReportsOverview)
router.get('/lead-sources', periodQuery, validate, ctrl.getLeadSources)
router.get('/dispatch-readiness', periodQuery, validate, ctrl.getDispatchReadiness)
router.get('/lead-conversion', periodQuery, validate, ctrl.getLeadConversion)
router.get('/tonnage-sold', periodQuery, validate, ctrl.getTonnageSold)
router.get('/ops-kpis', periodQuery, validate, ctrl.getOpsKpis)
router.get('/pipeline-stages', periodQuery, validate, ctrl.getPipelineStageOverview)
router.get('/query-handling', periodQuery, validate, ctrl.getQueryHandling)
router.get('/pipeline-kanban', periodQuery, validate, ctrl.getPipelineKanban)
router.get('/recent-closed-deals', periodQuery, validate, ctrl.getRecentClosedDeals)
router.get('/sales-activity', periodQuery, validate, ctrl.getSalesActivity)
router.get('/top-performers', periodQuery, validate, ctrl.getTopPerformers)
router.get('/tax-summary', periodQuery, validate, ctrl.getTaxSummary)
router.get('/tax-by-state', periodQuery, validate, ctrl.getTaxByState)
router.get('/tax-by-building-type', periodQuery, validate, ctrl.getTaxByBuildingType)
router.get('/construction-progress', periodQuery, validate, ctrl.getConstructionProgress)
router.get('/plant-production', periodQuery, validate, ctrl.getPlantProduction)
router.get('/business-highlights', periodQuery, validate, ctrl.getBusinessHighlights)
router.get('/customer-approvals', periodQuery, validate, ctrl.getCustomerApprovals)
router.get('/sales-mix', periodQuery, validate, ctrl.getSalesMix)
router.get(
  '/search',
  [query('q').optional().isString(), query('search').optional().isString(), query('limit').optional().isInt({ min: 1, max: 50 })],
  validate,
  ctrl.searchGlobal,
)

module.exports = router
