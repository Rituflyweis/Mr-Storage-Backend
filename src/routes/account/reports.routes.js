const router = require('express').Router()
const ctrl = require('../../controllers/account/reports.controller')

router.get('/profit-loss', ctrl.getProfitLoss)
router.get('/cash-flow', ctrl.getCashFlow)
router.get('/project-wise-expense', ctrl.getProjectWiseExpense)
router.get('/project-wise-income', ctrl.getProjectWiseIncome)

module.exports = router
