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
    body('email').isEmail().normalizeEmail(),
    body('role').notEmpty(),
    body('password').notEmpty().trim(),
    body('phone').optional().trim(),
    body('department').optional().trim(),
    body('permissions').optional().isObject(),
    body('isActive').optional().isBoolean(),
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
router.put('/:userId',
  [
    body('name').optional().notEmpty().trim(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().trim(),
    body('role').optional().notEmpty(),
    body('department').optional().trim(),
    body('permissions').optional().isObject(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.updateEmployee
)
router.delete('/:userId', ctrl.deleteEmployee)

module.exports = router
