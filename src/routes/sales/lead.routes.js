const router = require('express').Router()
const { body, query } = require('express-validator')
const { LEAD_TEMPERATURES } = require('../../config/constants')
const ctrl = require('../../controllers/sales/lead.controller')
const chatCtrl = require('../../controllers/common/chatLifecycle.controller')
const agreementCtrl = require('../../controllers/common/agreement.controller')
const validate = require('../../middleware/validate')
const { leadCreateFieldValidators, leadEditFieldValidators } = require('../../utils/leadCreateValidators')

// ── Static routes BEFORE /:leadId ─────────────────────────────────────────────
router.get('/stats', ctrl.getLeadsStats)
router.get('/by-score',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('temperature').optional().isIn(LEAD_TEMPERATURES),
    query('status').optional().isIn(LEAD_TEMPERATURES),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getLeadsByScore
)
router.get('/scored', ctrl.getScoredLeads)
router.get('/escalated', ctrl.getEscalatedLeads)
router.get('/with-po',
  [
    query('poStatus').optional().isIn(['pending', 'approved', 'rejected']),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getLeadsWithPo
)
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
router.get('/:leadId/chat-status', chatCtrl.getChatStatus)
router.put('/:leadId/chat/end', chatCtrl.endChat)
router.put('/:leadId/chat/reopen', chatCtrl.reopenChat)

router.get('/:leadId/agreement', agreementCtrl.getLeadAgreement)
router.get('/:leadId/detail', ctrl.getLeadDetail)
router.get('/:leadId/notes', ctrl.getLeadNotes)
router.post('/:leadId/notes',
  [body('note').notEmpty().trim()],
  validate,
  ctrl.createLeadNote
)
router.get('/:leadId/buildings', ctrl.getBuildings)

router.put('/:leadId/lifecycle',
  [body('lifecycleStatus').notEmpty()],
  validate,
  ctrl.updateLifecycle
)

router.put('/:leadId/temperature',
  [body('temperature').isIn(LEAD_TEMPERATURES)],
  validate,
  ctrl.updateLeadTemperature
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
