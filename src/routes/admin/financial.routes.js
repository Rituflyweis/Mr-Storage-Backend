const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/financial.controller')
const validate = require('../../middleware/validate')

// Existing
router.get('/overview',       ctrl.getOverview)
router.get('/per-project',    ctrl.getPerProject)
router.get('/invoice-aging',  ctrl.getInvoiceAging)

// Payments Dashboard
router.get('/payments-dashboard', ctrl.getPaymentsDashboard)

// Tax & Filling
router.get('/tax-filing',              ctrl.getTaxFiling)
router.get('/tax-filing/:taxId/prepare', ctrl.prepareFiling)
router.put('/tax-filing/:taxId/file',  ctrl.completeFiling)

// State Wise Tax
router.get('/state-wise-tax',   ctrl.getStateWiseTax)
router.post('/state-wise-tax/sync', ctrl.syncStateTax)

// Project Wise Tax
router.get('/project-wise-tax', ctrl.getProjectWiseTax)

// Payment Approvals
router.get('/payment-approvals', ctrl.getPaymentApprovals)
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
router.get('/payment-status', ctrl.getPaymentStatus)

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
router.post('/expenses',          [require('express-validator').body('category').notEmpty(), require('express-validator').body('amount').isNumeric()], require('../../middleware/validate'), ctrl.createExpense)
router.put('/expenses/:expenseId',    ctrl.updateExpense)
router.delete('/expenses/:expenseId', ctrl.deleteExpense)
router.get('/profit-loss',            ctrl.getProfitLoss)
router.get('/freight-cost-tracking',  ctrl.getFreightCostTracking)
router.get('/margin-analysis',        ctrl.getMarginAnalysis)
router.get('/budget-vs-actual',       ctrl.getBudgetVsActual)

module.exports = router
