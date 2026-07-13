const router = require('express').Router()
const ctrl = require('../../controllers/common/notification.controller')

router.get('/',               ctrl.getNotifications)
router.put('/read-all',       ctrl.markAllRead)
router.put('/:id/read',       ctrl.markRead)
router.delete('/:id',         ctrl.deleteNotification)

module.exports = router
