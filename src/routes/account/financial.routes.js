const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/account/financial.controller')
const marginCtrl = require('../../controllers/account/margin.controller')
const validate = require('../../middleware/validate')

const marginQueryBase = [
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('leadId').optional({ checkFalsy: true }).isMongoId(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
  query('businessUnit').optional().trim(),
  query('company').optional().trim(),
]

/** KPI / P&L date presets when startDate & endDate omitted */
const marginQuery = [
  ...marginQueryBase,
  query('period').optional().isIn(['monthly', 'quarterly', 'yearly']),
]

/** Trend chart bucket size (not the same as marginQuery period presets) */
const marginTrendQuery = [
  ...marginQueryBase,
  query('period').optional().isIn(['month', 'quarter', 'year']),
]

// Delivery Finance (dashboard card)
router.get('/delivery-finance', ctrl.getDeliveryFinance)

// Freight Costs Overview
router.get('/freight-costs', ctrl.getFreightCostsOverview)

// Logistics Costs
router.get('/logistics-costs', ctrl.getLogisticsCosts)

// Cost Variance Analysis
router.get('/cost-variance', ctrl.getCostVarianceAnalysis)

// Awarded Freight Loads
router.get('/awarded-loads', ctrl.getAwardedFreightLoads)

// Project-level Financial Summary
router.get('/project-summary', ctrl.getProjectFinancialSummary)

// Payment Approvals
router.get('/payment-approvals/filters', ctrl.getPaymentApprovalFilters)
router.get('/payment-approvals/export', ctrl.exportPaymentApprovals)
router.get('/payment-approvals/stats', ctrl.getPaymentApprovalStats)
router.get('/payment-approvals', ctrl.getPaymentApprovals)
router.get('/payment-approvals/:approvalId', ctrl.getPaymentApprovalDetail)
router.put('/payment-approvals/:approvalId/review',
  [body('action').isIn(['under_review', 'approved', 'disputed', 'rejected'])],
  validate,
  ctrl.reviewPaymentApproval
)

// Payment Status Dashboard
router.get('/payment-status', ctrl.getPaymentStatusDashboard)

// Invoice Management sub-tabs
router.get('/invoices/vendor',           ctrl.getVendorInvoices)
router.get('/invoices/carrier',          ctrl.getCarrierInvoices)
router.get('/invoices/delivery-company', ctrl.getDeliveryCompanyInvoices)

// Analytics -> Reporting
router.get('/reporting', ctrl.getAnalyticsReporting)

// Master Data
router.get('/master-data/vendors',            ctrl.getMasterDataVendors)
router.get('/master-data/carriers',           ctrl.getMasterDataCarriers)
router.get('/master-data/delivery-companies', ctrl.getMasterDataDeliveryCompanies)

// Margin Breakdown (Figma — Payments submenu)
router.get('/margin-analysis/filters', marginCtrl.getMarginFilters)
router.get('/margin-analysis/trend', marginTrendQuery, validate, marginCtrl.getMarginTrend)
router.get('/margin-analysis/by-project', marginQuery, validate, marginCtrl.getMarginByProjects)
router.get('/margin-analysis', marginQuery, validate, marginCtrl.getMarginAnalysis)

// Profit & Loss (Margin tab table + detail)
router.get(
  '/profit-loss/summary',
  [
    ...marginQuery,
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  marginCtrl.getProfitLossSummary
)
router.get('/profit-loss/export', marginQuery, validate, marginCtrl.exportProfitLoss)
router.get('/profit-loss', marginQuery, validate, marginCtrl.getProfitLossDetail)

// Budget vs Actual tab
router.get('/budget-vs-actual', marginQuery, validate, marginCtrl.getBudgetVsActual)

module.exports = router
