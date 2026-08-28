const router = require('express').Router()
const ctrl = require('../../controllers/common/notification.controller')

router.get('/',               ctrl.getNotifications)
router.get('/unread-count',   ctrl.getUnreadCount)
router.put('/read-all',       ctrl.markAllRead)
router.put('/:id/read',       ctrl.markRead)
router.delete('/:id',         ctrl.deleteNotification)

module.exports = router
