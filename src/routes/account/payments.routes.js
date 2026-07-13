const router = require('express').Router()
const ctrl = require('../../controllers/account/payments.controller')

router.get('/overview', ctrl.getPaymentOverview)
router.get('/orders',   ctrl.getOrdersAndPayments)

module.exports = router
