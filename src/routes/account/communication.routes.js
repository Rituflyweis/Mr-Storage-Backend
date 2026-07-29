const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/account/communication.controller')
const validate = require('../../middleware/validate')

router.get('/channels',                                    ctrl.getChannels)
router.get('/channels/:channelType/:channelId/messages',    ctrl.getChannelMessages)
router.post('/channels/:channelType/:channelId/messages',
  [body('content').notEmpty()],
  validate,
  ctrl.sendChannelMessage
)

module.exports = router
