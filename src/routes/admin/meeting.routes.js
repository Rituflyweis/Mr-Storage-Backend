const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/admin/meeting.controller')
const validate = require('../../middleware/validate')
const { MEETING_STATUSES } = require('../../config/constants')
const { normalizeMeetingMode, isValidMeetingModeInput } = require('../../utils/meetingMode')

const meetingModeValidator = () =>
  body('mode')
    .custom((value) => {
      if (!isValidMeetingModeInput(value)) {
        throw new Error('mode must be online, offline, or in-person')
      }
      return true
    })
    .customSanitizer((value) => normalizeMeetingMode(value))

const optionalMeetingModeValidator = () =>
  body('mode')
    .optional()
    .custom((value) => {
      if (value == null || value === '') return true
      if (!isValidMeetingModeInput(value)) {
        throw new Error('mode must be online, offline, or in-person')
      }
      return true
    })
    .customSanitizer((value) => (value == null || value === '' ? value : normalizeMeetingMode(value)))

router.get('/',
  [
    query('status').optional().isIn(MEETING_STATUSES),
    query('search').optional().trim(),
    query('leadId').optional().isMongoId(),
  ],
  validate,
  ctrl.getMeetings
)
router.post('/',
  [
    body('customerId').notEmpty(),
    body('title').notEmpty().trim(),
    body('meetingTime').isISO8601(),
    meetingModeValidator(),
    body('reminderMinutes').optional().isInt({ min: 0, max: 10080 }),
    body('reminderSms').optional().isBoolean(),
    body('reminderEmail').optional().isBoolean(),
  ],
  validate,
  ctrl.createMeeting
)

router.get('/:meetingId', ctrl.getMeetingById)

router.put('/:meetingId/complete', ctrl.completeMeeting)
router.put('/:meetingId',
  [
    body('customerId').optional().isMongoId(),
    body('leadId').optional({ nullable: true }).isMongoId(),
    body('meetingTime').optional().isISO8601(),
    optionalMeetingModeValidator(),
    body('status').optional().isIn(MEETING_STATUSES),
    body('reminderMinutes').optional().isInt({ min: 0, max: 10080 }),
    body('reminderSms').optional().isBoolean(),
    body('reminderEmail').optional().isBoolean(),
  ],
  validate,
  ctrl.editMeeting
)

module.exports = router
