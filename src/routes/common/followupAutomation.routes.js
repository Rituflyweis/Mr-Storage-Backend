const router = require('express').Router()
const { body } = require('express-validator')
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/followupAutomation.controller')

router.get('/config', verifyToken, roleGuard(['admin', 'sales']), ctrl.getConfig)
router.put('/config', verifyToken, roleGuard(['admin', 'sales']), ctrl.updateConfig)
router.post('/run-now', verifyToken, roleGuard(['admin']), ctrl.runNow)
router.post(
  '/chat/:leadId/send-now',
  verifyToken,
  roleGuard(['admin', 'sales']),
  [body('message').optional().isString()],
  validate,
  ctrl.sendChatDropoffNow
)

module.exports = router
