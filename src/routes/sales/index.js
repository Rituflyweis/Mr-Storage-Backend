const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

router.use(verifyToken, roleGuard(['sales']))

router.use('/dashboard', require('./dashboard.routes'))
router.use('/leads', require('./lead.routes'))
router.use('/followups', require('./followup.routes'))
router.use('/customers', require('./customer.routes'))

const leadCtrl = require('../../controllers/sales/lead.controller')
const followupCtrl = require('../../controllers/sales/followup.controller')


router.get('/po-orders', leadCtrl.getMyPOOrders)
router.get('/quotations', followupCtrl.getMyQuotations)

module.exports = router
