const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/followup.controller')
const validate = require('../../middleware/validate')

// ── Static routes BEFORE /:followUpId ─────────────────────────────────────────
router.get('/stats', ctrl.getStats)
router.get('/upcoming', ctrl.getUpcoming)
router.get('/trend', ctrl.getTrend)
router.get('/response-rate', ctrl.getResponseRate)
router.get('/communication-timeline', ctrl.getCommunicationTimeline)
router.get('/ai-script', ctrl.getAIScriptSessions)

router.post('/ai-script',
  [body('messages').isArray({ min: 1 })],
  validate,
  ctrl.postAIScript
)

router.post('/',
  [
    body('leadId').notEmpty(),
    body('followUpDate').isISO8601(),
    body('modeOfContact').optional().isIn(['call', 'email', 'meeting']),
  ],
  validate,
  ctrl.createFollowUp
)

router.put('/:followUpId/complete', ctrl.completeFollowUp)

module.exports = router
