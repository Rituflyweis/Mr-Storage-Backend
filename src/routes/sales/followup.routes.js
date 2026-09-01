const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/followup.controller')
const validate = require('../../middleware/validate')

// ── Static routes BEFORE /:followUpId ─────────────────────────────────────────
router.get('/stats',                  ctrl.getStats)
router.get('/upcoming',               ctrl.getUpcoming)
router.get('/trend',                  ctrl.getTrend)
router.get('/response-rate',          ctrl.getResponseRate)
router.get('/communication-timeline', ctrl.getCommunicationTimeline)
router.get('/ai-script',              ctrl.getAIScriptSessions)
router.get('/smart-reminders',        ctrl.getSmartReminders)
router.get('/kpis',                   ctrl.getFollowUpKPIs)
router.get('/payment-followup',       ctrl.getPaymentFollowUps)
router.post('/payment-followup',
  [
    body('invoiceId').notEmpty().isMongoId(),
    body('leadId').notEmpty().isMongoId(),
    body('nextFollowUp').optional().isISO8601(),
  ],
  validate,
  ctrl.createPaymentFollowUp
)
router.put('/payment-followup/:followUpId/status',
  [body('status').notEmpty()],
  validate,
  ctrl.updatePaymentFollowUpStatus
)

router.post('/ai-script',
  [body('messages').isArray({ min: 1 })],
  validate,
  ctrl.postAIScript
)

router.post('/',
  [
    body('leadId').notEmpty(),
    body('followUpDate').isISO8601(),
    body('modeOfContact').optional().isIn(['call', 'email', 'meeting', 'sms']),
    body('reminderMinutes').optional().isInt({ min: 0, max: 10080 }),
    body('notifyCustomer').optional().isBoolean(),
    body('sendSms').optional().isBoolean(),
    body('sendEmail').optional().isBoolean(),
  ],
  validate,
  ctrl.createFollowUp
)

router.put('/:followUpId/complete', ctrl.completeFollowUp)

module.exports = router
