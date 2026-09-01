const router = require('express').Router()
const { query, body } = require('express-validator')
const ctrl = require('../../controllers/common/calendar.controller')
const validate = require('../../middleware/validate')

router.get(
  '/events',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('userId').optional().isMongoId(),
    query('status').optional().isIn(['scheduled', 'completed', 'cancelled']),
    query('kind').optional().isIn(['meeting', 'followup']),
  ],
  validate,
  ctrl.getEvents
)

router.put(
  '/events/:eventId/reminder',
  [
    body('reminderMinutes').optional().isInt({ min: 0, max: 10080 }),
    body('reminderSms').optional().isBoolean(),
    body('reminderEmail').optional().isBoolean(),
  ],
  validate,
  ctrl.updateReminder
)

module.exports = router
