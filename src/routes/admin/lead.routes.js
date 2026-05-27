const router = require('express').Router()
const { body, query } = require('express-validator')
const { LEAD_TEMPERATURES } = require('../../config/constants')
const ctrl = require('../../controllers/admin/lead.controller')
const validate = require('../../middleware/validate')
const { leadCreateFieldValidators, leadEditFieldValidators } = require('../../utils/leadCreateValidators')

// ── Static routes BEFORE /:leadId ─────────────────────────────────────────────
router.get('/stats', ctrl.getLeadStats)
router.get('/ai-handled', ctrl.getAiHandledLeads)
router.get('/signed-contracts', ctrl.getSignedContracts)
router.get('/terminated', ctrl.getTerminatedLeads)
router.get('/scoring/today', ctrl.getScoringToday)
router.get('/by-score',
  [
    query('temperature').optional().isIn(LEAD_TEMPERATURES),
    query('status').optional().isIn(LEAD_TEMPERATURES),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getLeadsByScore
)
router.post('/import', ctrl.importLeads)
router.get('/export/excel', ctrl.exportLeadsExcel)

router.get('/', ctrl.getAllLeads)
router.post('/',
  [
    body('customerId').notEmpty().isMongoId(),
    ...leadCreateFieldValidators,
    body('assignedSales').optional().isMongoId(),
  ],
  validate,
  ctrl.createLead
)

// ── Parameterised routes ───────────────────────────────────────────────────────
router.get('/:leadId/detail', ctrl.getLeadDetail)
router.get('/:leadId/timeline', ctrl.getLeadTimeline)
router.get('/:leadId/documents',
  [query('type').optional().isIn(['drawing', 'approval', 'general', 'contract', 'photo', 'other'])],
  validate,
  ctrl.getLeadDocuments
)
router.get('/:leadId/budget', ctrl.getLeadBudget)

router.post('/:leadId/budget',
  [body('materialBudget').optional().isNumeric(), body('logisticBudget').optional().isNumeric()],
  validate,
  ctrl.setLeadBudget
)

router.put('/:leadId/buildings/:buildingId/approve-bom',
  [body('action').isIn(['approved', 'rejected'])],
  validate,
  ctrl.approveBOM
)

router.put('/:leadId/terminate',
  [body('reason').notEmpty().trim()],
  validate,
  ctrl.terminateLead
)

router.put('/:leadId/temperature',
  [body('temperature').isIn(LEAD_TEMPERATURES)],
  validate,
  ctrl.updateLeadTemperature
)

router.put('/:leadId', leadEditFieldValidators, validate, ctrl.editLead)
router.put('/:leadId/assign',
  [body('employeeId').notEmpty()],
  validate,
  ctrl.assignLead
)

module.exports = router
