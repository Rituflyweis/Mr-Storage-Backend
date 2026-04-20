const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/meeting.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getMeetings)
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

router.put('/:meetingId', ctrl.editMeeting)
router.put('/:meetingId/complete', ctrl.completeMeeting)

module.exports = router
