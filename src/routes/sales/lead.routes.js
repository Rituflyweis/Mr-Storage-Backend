const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/lead.controller')
const validate = require('../../middleware/validate')
const { leadCreateFieldValidators, leadEditFieldValidators } = require('../../utils/leadCreateValidators')

// ── Static routes BEFORE /:leadId ─────────────────────────────────────────────
router.get('/stats', ctrl.getLeadsStats)
router.get('/scored', ctrl.getScoredLeads)
router.get('/escalated', ctrl.getEscalatedLeads)
router.get('/export', ctrl.exportLeads)
router.get('/export/excel', ctrl.exportLeadsExcel)

router.post('/import',
  [body('csv').notEmpty().withMessage('csv is required')],
  validate,
  ctrl.importLeads
)

router.get('/', ctrl.getLeads)

router.post('/',
  [
    body('customerId').notEmpty().isMongoId(),
    ...leadCreateFieldValidators,
    body('notes').optional().trim(),
    body('leadStatus').optional().trim(),
  ],
  validate,
  ctrl.createLead
)

// ── Parameterised routes ───────────────────────────────────────────────────────
router.get('/:leadId/detail', ctrl.getLeadDetail)
router.get('/:leadId/buildings', ctrl.getBuildings)

router.put('/:leadId/lifecycle',
  [body('lifecycleStatus').notEmpty()],
  validate,
  ctrl.updateLifecycle
)

router.put('/:leadId', leadEditFieldValidators, validate, ctrl.editLead)

router.post('/:leadId/activity',
  [
    body('activityType').isIn(['call', 'email', 'meeting', 'note']),
    body('outcome').optional().isIn(['positive', 'neutral', 'negative', 'no_response']),
  ],
  validate,
  ctrl.logActivity
)

router.post('/:leadId/buildings',
  [body('numberOfBuildings').isInt({ min: 1 })],
  validate,
  ctrl.createBuildings
)

router.post('/:leadId/escalate',
  [body('note').notEmpty().trim()],
  validate,
  ctrl.escalateLead
)

router.post('/:leadId/po-order', ctrl.raisePOOrder)

module.exports = router
