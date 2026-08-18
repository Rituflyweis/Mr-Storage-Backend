const router = require('express').Router()
const ctrl = require('../../controllers/plant/dashboard.controller')

router.get('/', ctrl.getDashboard)

module.exports = router
