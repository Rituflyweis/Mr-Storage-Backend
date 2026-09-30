const router = require('express').Router()
const ctrl = require('../../controllers/sales/construction.controller')
const validate = require('../../middleware/validate')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')

const businessUnitQuery = [businessUnitQueryValidator(), validate]

router.get('/projects/calendar', businessUnitQuery, ctrl.getProjectCalendar)
router.get('/projects', businessUnitQuery, ctrl.getProjects)

module.exports = router
