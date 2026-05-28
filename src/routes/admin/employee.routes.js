const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/admin/employee.controller')
const validate = require('../../middleware/validate')

// Special routes before /:userId
router.get('/stats', ctrl.getStats)
router.get('/performance', ctrl.getPerformance)
router.get('/audit-log', ctrl.getEmployeesAuditLog)

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

router.get('/:userId/assigned-leads',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getEmployeeAssignedLeads
)
router.get('/:userId/timeline', ctrl.getEmployeeTimeline)
router.patch('/:userId/toggle-status', ctrl.toggleStatus)
router.post('/:userId/reset-password', ctrl.resetPassword)
router.get('/:userId', ctrl.getEmployeeDetail)
router.put('/:userId', ctrl.updateEmployee)

module.exports = router
