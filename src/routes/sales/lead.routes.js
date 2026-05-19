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
    body('projectName').optional({ checkFalsy: true }).trim(),
    body('customerEmail').optional({ checkFalsy: true }).isEmail(),
    body('email').optional({ checkFalsy: true }).isEmail(),
    body('emailAddress').optional({ checkFalsy: true }).isEmail(),
    body('buildingType').optional({ checkFalsy: true }).trim(),
    body('projectType').optional({ checkFalsy: true }).trim(),
    body('structureType').optional({ checkFalsy: true }).trim(),
    body('location').optional({ checkFalsy: true }).trim(),
    body('city').optional({ checkFalsy: true }).trim(),
    body('projectLocation').optional({ checkFalsy: true }).trim(),
    body('siteLocation').optional({ checkFalsy: true }).trim(),
    body('companyLocation').optional({ checkFalsy: true }).trim(),
    body('width').optional({ checkFalsy: true }).isNumeric(),
    body('length').optional({ checkFalsy: true }).isNumeric(),
    body('height').optional({ checkFalsy: true }).isNumeric(),
    body('lastName').optional({ checkFalsy: true }).trim(),
    body('doors').optional({ checkFalsy: true }).isNumeric(),
    body('windows').optional({ checkFalsy: true }).isNumeric(),
    body('insulation').optional({ checkFalsy: true }).isNumeric(),
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

router.post('/:leadId/po-order', ctrl.raisePOOrder)

module.exports = router
