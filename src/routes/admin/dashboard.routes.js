const router = require('express').Router()
const ctrl = require('../../controllers/admin/dashboard.controller')

router.get('/lead-stats', ctrl.getLeadStats)
router.get('/customer-stats', ctrl.getCustomerStats)
router.get('/ai-vs-human', ctrl.getAiVsHuman)

module.exports = router
