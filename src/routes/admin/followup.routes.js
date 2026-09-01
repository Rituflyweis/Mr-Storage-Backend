const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/admin/followup.controller')
const validate = require('../../middleware/validate')
const { FOLLOW_UP_MODES, FOLLOW_UP_STATUSES } = require('../../config/constants')

router.get('/', ctrl.getAllFollowups)
router.get('/activity-log',
  [
    query('employeeId').optional().isMongoId(),
    query('type').optional().isIn(FOLLOW_UP_MODES),
    query('status').optional().isIn([...FOLLOW_UP_STATUSES, 'overdue']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('startDate').optional(),
    query('endDate').optional(),
  ],
  validate,
  ctrl.getFollowUpActivityLog
)
router.get('/stats', ctrl.getStats)
router.get('/upcoming', ctrl.getUpcoming)
router.get('/kpi', ctrl.getKpi)
router.get('/ai-script', ctrl.getAiScript)

router.post('/',
  [
    body('leadId').notEmpty(),
    body('assignedTo').notEmpty(),
    body('followUpDate').isISO8601(),
    body('modeOfContact').optional().isIn(FOLLOW_UP_MODES),
    body('reminderMinutes').optional().isInt({ min: 0, max: 10080 }),
    body('notifyCustomer').optional().isBoolean(),
    body('sendSms').optional().isBoolean(),
    body('sendEmail').optional().isBoolean(),
  ],
  validate,
  ctrl.createFollowUp
)

router.put('/:followUpId/complete', ctrl.completeFollowUp)

module.exports = router
