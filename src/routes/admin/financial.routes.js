const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/admin/financial.controller')
const validate = require('../../middleware/validate')

// Existing
router.get('/overview',       ctrl.getOverview)
router.get('/per-project',    ctrl.getPerProject)
router.get('/invoice-aging',  ctrl.getInvoiceAging)

// Payments Dashboard
router.get('/payments-dashboard',        ctrl.getPaymentsDashboard)
router.get('/payments-dashboard/export', ctrl.exportPaymentsDashboard)

// Tax & Filling
const taxFilingListQuery = [
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('clientId').optional({ checkFalsy: true }).isMongoId(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
  query('search').optional().trim(),
]
router.get('/tax-filing',              taxFilingListQuery, validate, ctrl.getTaxFiling)
router.get('/tax-filing/stats',
  [
    query('projectId').optional({ checkFalsy: true }).isMongoId(),
    query('clientId').optional({ checkFalsy: true }).isMongoId(),
    query('search').optional().trim(),
  ],
  validate,
  ctrl.getTaxFilingStats
)
router.get('/tax-filing/filters',      ctrl.getTaxFilingFilters)
router.get('/tax-filing/:taxId/prepare', ctrl.prepareFiling)
router.put('/tax-filing/:taxId/file',  ctrl.completeFiling)

// State Wise Tax
const stateWiseTaxQuery = [
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
]
router.get('/state-wise-tax',                    stateWiseTaxQuery, validate, ctrl.getStateWiseTax)
router.get('/state-wise-tax/stats',               stateWiseTaxQuery, validate, ctrl.getStateWiseTaxStats)
router.get('/state-wise-tax/export',              stateWiseTaxQuery, validate, ctrl.exportStateWiseTax)
router.get('/state-wise-tax/upcoming-deadlines',
  [
    query('projectId').optional({ checkFalsy: true }).isMongoId(),
    query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 50 }),
  ],
  validate,
  ctrl.getUpcomingFilingDeadlines
)
router.post('/state-wise-tax/sync', ctrl.syncStateTax)

// Project Wise Tax
const projectWiseTaxQuery = [
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
]
router.get('/project-wise-tax',
  [...projectWiseTaxQuery, query('page').optional({ checkFalsy: true }).isInt({ min: 1 }), query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 200 })],
  validate,
  ctrl.getProjectWiseTax
)
router.get('/project-wise-tax/stats',  projectWiseTaxQuery, validate, ctrl.getProjectWiseTaxStats)
router.get('/project-wise-tax/export', projectWiseTaxQuery, validate, ctrl.exportProjectWiseTax)

// Payment Approvals
const paymentApprovalQuery = [
  query('status').optional({ checkFalsy: true }).isIn(['pending', 'under_review', 'approved', 'disputed', 'rejected']),
  query('category').optional({ checkFalsy: true }).isIn(['vendor_payment', 'shipper_payment', 'equipment', 'other_expenses']),
  query('requestedBy').optional({ checkFalsy: true }).isMongoId(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
]
router.get('/payment-approvals',
  [...paymentApprovalQuery, query('page').optional({ checkFalsy: true }).isInt({ min: 1 }), query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 200 })],
  validate,
  ctrl.getPaymentApprovals
)
router.get('/payment-approvals/filters', ctrl.getPaymentApprovalFilters)
router.get('/payment-approvals/export', paymentApprovalQuery, validate, ctrl.exportPaymentApprovals)
router.post('/payment-approvals',
  [body('payee').notEmpty(), body('category').notEmpty(), body('amount').isNumeric()],
  validate,
  ctrl.createPaymentApproval
)
router.put('/payment-approvals/:approvalId/review',
  [body('action').isIn(['approved', 'rejected'])],
  validate,
  ctrl.reviewPaymentApproval
)

// Payment Status
const paymentStatusQuery = [
  query('paymentMethod').optional({ checkFalsy: true }).isIn(['cash', 'bank_transfer', 'credit_card', 'upi', 'cheque', 'other']),
  query('status').optional({ checkFalsy: true }).isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
  query('search').optional().trim(),
]
router.get('/payment-status',
  [...paymentStatusQuery, query('page').optional({ checkFalsy: true }).isInt({ min: 1 }), query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 200 })],
  validate,
  ctrl.getPaymentStatus
)
router.get('/payment-status/export', paymentStatusQuery, validate, ctrl.exportPaymentStatus)

// Financial Overview sub-pages
router.get('/financial-overview', ctrl.getFinancialOverview)
router.get('/financial-overview/export', ctrl.exportFinancialOverview)
router.get('/wip-profits',        ctrl.getWIPProfits)
router.get('/wip-profits/export', ctrl.exportWIPProfits)
router.post('/wip-profits',       ctrl.createWIPEntry)
router.post('/wip-profits/:leadId/payments',
  [body('paymentType').isIn(['deposit', 'progress', 'final']), body('amount').isNumeric(), body('paymentDate').notEmpty()],
  validate,
  ctrl.addWIPPayment
)
router.get('/expenses',           ctrl.getExpenses)
router.get('/expenses/export',    ctrl.exportExpenses)
router.post('/expenses/import',   ctrl.importExpenses)
router.get('/expenses/filters',   ctrl.getExpenseFilters)
router.get('/expenses/categories', ctrl.getExpenseCategories)
router.post('/expenses/categories', [body('name').notEmpty()], validate, ctrl.createExpenseCategory)
router.get('/expenses/summary/monthly', ctrl.getExpenseMonthlySummary)
router.get('/expenses/by-category', ctrl.getExpensesByCategory)
router.get('/expenses/budget-vs-actual-trend', ctrl.getExpenseBudgetVsActualTrend)
router.post('/expenses',          [require('express-validator').body('category').notEmpty(), require('express-validator').body('amount').isNumeric()], require('../../middleware/validate'), ctrl.createExpense)
router.put('/expenses/:expenseId',    ctrl.updateExpense)
router.delete('/expenses/:expenseId', ctrl.deleteExpense)
router.get('/profit-loss',            ctrl.getProfitLoss)
router.get('/profit-loss/export',     ctrl.exportProfitLoss)
router.get('/profit-loss/projects',   ctrl.getProfitLossByProject)
router.get('/freight-cost-tracking',  ctrl.getFreightCostTracking)
router.get('/freight-cost-tracking/carrier-analysis', ctrl.getFreightCarrierCostAnalysis)
router.get('/freight-cost-tracking/recent', ctrl.getRecentFreightCosts)
router.get('/freight-cost-tracking/export', ctrl.exportFreightCosts)
router.get('/margin-analysis',        ctrl.getMarginAnalysis)
router.get('/margin-analysis/trend',  ctrl.getMarginTrendOverTime)
router.get('/margin-analysis/by-project', ctrl.getMarginByProjects)
router.get('/budget-vs-actual',       ctrl.getBudgetVsActual)

module.exports = router
