const router = require('express').Router()
const ctrl = require('../../controllers/account/reports.controller')

router.get('/profit-loss', ctrl.getProfitLoss)
router.get('/cash-flow',   ctrl.getCashFlow)

module.exports = router
