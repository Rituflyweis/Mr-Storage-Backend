const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/employee.controller')
const validate = require('../../middleware/validate')

// Special routes before /:userId
router.get('/stats', ctrl.getStats)
router.get('/performance', ctrl.getPerformance)

router.get('/', ctrl.getAllEmployees)
router.post('/',
  [
    body('name').notEmpty().trim(),
    body('email').isEmail(),
    body('role').notEmpty(),
  ],
  validate,
  ctrl.createEmployee
)

router.get('/:userId/timeline', ctrl.getEmployeeTimeline)
router.patch('/:userId/toggle-status', ctrl.toggleStatus)
router.post('/:userId/reset-password', ctrl.resetPassword)
router.get('/:userId', ctrl.getEmployeeDetail)
router.put('/:userId', ctrl.updateEmployee)

module.exports = router
