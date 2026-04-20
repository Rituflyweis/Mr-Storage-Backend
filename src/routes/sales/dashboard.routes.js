const router = require('express').Router()
const ctrl = require('../../controllers/sales/dashboard.controller')

router.get('/lead-stats', ctrl.getLeadStats)
router.get('/customer-stats', ctrl.getCustomerStats)

module.exports = router
