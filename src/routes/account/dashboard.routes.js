const router = require('express').Router()
const ctrl = require('../../controllers/account/dashboard.controller')

router.get('/stats',                ctrl.getStats)
router.get('/invoice-stats',        ctrl.getInvoiceStats)
router.get('/income-vs-expense',    ctrl.getIncomeVsExpense)
router.get('/recent-transactions',  ctrl.getRecentTransactions)
router.get('/upcoming-payments',    ctrl.getUpcomingPayments)
router.get('/payment-distribution', ctrl.getPaymentDistribution)
router.get('/revenue-trend',        ctrl.getRevenueTrend)
router.get('/expense-trend',        ctrl.getExpenseTrend)

module.exports = router
