const router = require('express').Router()
const ctrl = require('../../controllers/account/analytics.controller')

router.get('/wip-profit',             ctrl.getWipProfit)
router.get('/project-cost-analysis',  ctrl.getProjectCostAnalysis)
router.get('/order-vs-plant-costs',   ctrl.getOrderValueVsPlantCosts)

module.exports = router
