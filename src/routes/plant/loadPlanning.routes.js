const router = require('express').Router()
const ctrl = require('../../controllers/plant/bundlePlan.controller')

// Global load planning list across all projects assigned to the plant user
router.get('/projects', ctrl.getLoadPlanningProjects)

module.exports = router
