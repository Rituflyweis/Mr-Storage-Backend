// src/routes/sales/meeting.routes.js
const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/sales/meeting.controller')
const validate = require('../../middleware/validate')
const { MEETING_STATUSES } = require('../../config/constants')

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
    body('customerId').notEmpty().isMongoId(),
    body('leadId').optional().isMongoId(),
    body('title').notEmpty().trim(),
    body('meetingTime').isISO8601(),
    body('mode').isIn(['online', 'offline']),
    body('meetingLink').optional().trim(),
  ],
  validate,
  ctrl.createMeeting
)

router.put('/:meetingId/complete', ctrl.completeMeeting)

router.put('/:meetingId',
  [
    body('title').optional().trim(),
    body('meetingTime').optional().isISO8601(),
    body('mode').optional().isIn(['online', 'offline']),
    body('status').optional().isIn(MEETING_STATUSES),
  ],
  validate,
  ctrl.editMeeting
)

module.exports = router