const router = require('express').Router()
const ctrl = require('../../controllers/sales/dashboard.controller')

router.get('/stats', ctrl.getStats)
router.get('/conversion-funnel', ctrl.getConversionFunnel)
router.get('/performance-trend', ctrl.getPerformanceTrend)
router.get('/today-tasks', ctrl.getTodayTasks)
router.get('/lead-stats', ctrl.getLeadStats)
router.get('/customer-stats', ctrl.getCustomerStats)

module.exports = router
