const router = require('express').Router()
const ctrl = require('../../controllers/admin/financial.controller')

router.get('/overview', ctrl.getOverview)
router.get('/per-project', ctrl.getPerProject)
router.get('/invoice-aging', ctrl.getInvoiceAging)

module.exports = router
