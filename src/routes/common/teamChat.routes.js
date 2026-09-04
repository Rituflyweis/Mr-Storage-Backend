const router = require('express').Router()
const ctrl = require('../../controllers/common/teamChat.controller')

router.get('/users', ctrl.getUsers)
router.get('/conversations', ctrl.getConversations)
router.get('/unread-count', ctrl.getUnreadCount)

router.get('/direct/:userId/messages', ctrl.getDirectMessages)
router.post('/direct/:userId/messages', ctrl.sendDirectMessage)

router.post('/groups', ctrl.createGroup)
router.get('/groups/:groupId', ctrl.getGroupDetail)
router.put('/groups/:groupId/members', ctrl.updateGroupMembers)
router.get('/groups/:groupId/messages', ctrl.getGroupMessages)
router.post('/groups/:groupId/messages', ctrl.sendGroupMessage)

module.exports = router
