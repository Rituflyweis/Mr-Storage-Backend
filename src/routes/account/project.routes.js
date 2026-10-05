const router = require('express').Router()
const { param } = require('express-validator')
const ctrl = require('../../controllers/account/project.controller')
const validate = require('../../middleware/validate')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')

router.get('/', [businessUnitQueryValidator()], validate, ctrl.getProjects)

router.get(
  '/:projectId',
  [param('projectId').notEmpty().trim()],
  validate,
  ctrl.getProjectDetail
)

module.exports = router
