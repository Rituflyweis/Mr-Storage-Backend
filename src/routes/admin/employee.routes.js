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
    body('password').isLength({ min: 6 }),
    body('role').notEmpty(),
  ],
  validate,
  ctrl.createEmployee
)

router.get('/:userId/timeline', ctrl.getEmployeeTimeline)
router.get('/:userId', ctrl.getEmployeeDetail)
router.put('/:userId', ctrl.updateEmployee)

module.exports = router
