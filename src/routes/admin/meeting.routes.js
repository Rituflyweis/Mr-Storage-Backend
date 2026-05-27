const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/admin/meeting.controller')
const validate = require('../../middleware/validate')
const { MEETING_STATUSES } = require('../../config/constants')

router.get('/',
  [
    query('status').optional().isIn(MEETING_STATUSES),
    query('search').optional().trim(),
  ],
  validate,
  ctrl.getMeetings
)
router.post('/',
  [
    body('customerId').notEmpty(),
    body('title').notEmpty().trim(),
    body('meetingTime').isISO8601(),
    body('mode').isIn(['online', 'offline']),
    body('assignedTo').notEmpty(),
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
    body('mode').optional().isIn(['online', 'offline']),
    body('status').optional().isIn(MEETING_STATUSES),
    body('assignedTo').optional().isMongoId(),
  ],
  validate,
  ctrl.editMeeting
)

module.exports = router
