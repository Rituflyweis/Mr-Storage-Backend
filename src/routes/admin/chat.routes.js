const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/admin/chat.controller')
const validate = require('../../middleware/validate')

router.get('/users',                         ctrl.getUsersForDM)
router.get('/departments',                   ctrl.getDepartmentChannels)
router.get('/departments/:channelKey/messages', ctrl.getChannelMessages)
router.post('/departments/:channelKey/messages',
  [body('content').notEmpty()], validate, ctrl.sendChannelMessage
)
router.get('/direct',                        ctrl.getDirectConversations)
router.get('/direct/:userId/messages',       [param('userId').isMongoId()], validate, ctrl.getDirectMessages)
router.post('/direct/:userId/messages',
  [param('userId').isMongoId(), body('content').notEmpty()], validate, ctrl.sendDirectMessage
)

module.exports = router
