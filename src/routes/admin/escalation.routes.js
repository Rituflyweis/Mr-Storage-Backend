const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/escalation.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getAllEscalations)
router.put('/:escalationId/assign',
  [body('employeeId').notEmpty()],
  validate,
  ctrl.assignEscalation
)

module.exports = router
