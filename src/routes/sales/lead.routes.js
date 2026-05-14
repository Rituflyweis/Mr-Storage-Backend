const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/lead.controller')
const validate = require('../../middleware/validate')

// ── Static routes BEFORE /:leadId ─────────────────────────────────────────────
router.get('/stats', ctrl.getLeadsStats)
router.get('/scored', ctrl.getScoredLeads)
router.get('/escalated', ctrl.getEscalatedLeads)
router.get('/export', ctrl.exportLeads)

router.post('/import',
  [body('csv').notEmpty().withMessage('csv is required')],
  validate,
  ctrl.importLeads
)

router.get('/', ctrl.getLeads)

router.post('/',
  [
    body('projectName').notEmpty().trim(),
    body('customerEmail').isEmail(),
    body('buildingType').notEmpty().trim(),
    body('location').notEmpty().trim(),
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

router.put('/:leadId',
  [body('projectName').optional().trim()],
  validate,
  ctrl.editLead
)

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

router.post('/:leadId/po-order',
  [
    body('poNumber').notEmpty().trim(),
    body('invoiceId').notEmpty(),
    body('quotationId').notEmpty(),
  ],
  validate,
  ctrl.raisePOOrder
)

module.exports = router
