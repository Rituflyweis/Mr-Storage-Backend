const router = require('express').Router()
const ctrl = require('../../../controllers/plant/bundlePlan.controller')

router.get('/projects', ctrl.getLoadPlanningProjects)

module.exports = router
