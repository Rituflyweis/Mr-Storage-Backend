const router = require('express').Router()
const ctrl = require('../../controllers/account/project.controller')
const validate = require('../../middleware/validate')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')

router.get('/', [businessUnitQueryValidator()], validate, ctrl.getProjects)

module.exports = router
