const router = require('express').Router()
const ctrl = require('../../controllers/plant/dashboard.controller')

router.get('/', ctrl.getDashboard)
router.post('/production-log', ctrl.logProduction)

module.exports = router
