const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/lead.controller')
const validate = require('../../middleware/validate')

// ── Static routes BEFORE /:leadId ─────────────────────────────────────────────
router.get('/stats', ctrl.getLeadStats)
router.get('/ai-handled', ctrl.getAiHandledLeads)
router.get('/signed-contracts', ctrl.getSignedContracts)
router.get('/terminated', ctrl.getTerminatedLeads)
router.get('/scoring/today', ctrl.getScoringToday)
router.post('/import', ctrl.importLeads)

router.get('/', ctrl.getAllLeads)
router.post('/',
  [
    body('customerId').notEmpty(),
    body('projectName').optional().trim(),
    body('buildingType').optional().trim(),
    body('location').optional().trim(),
    body('width').optional().isNumeric(),
    body('length').optional().isNumeric(),
    body('height').optional().isNumeric(),
  ],
  validate,
  ctrl.createLead
)

// ── Parameterised routes ───────────────────────────────────────────────────────
router.get('/:leadId/detail', ctrl.getLeadDetail)
router.get('/:leadId/timeline', ctrl.getLeadTimeline)
router.get('/:leadId/budget', ctrl.getLeadBudget)

router.post('/:leadId/budget',
  [body('materialBudget').optional().isNumeric(), body('logisticBudget').optional().isNumeric()],
  validate,
  ctrl.setLeadBudget
)

router.put('/:leadId/terminate',
  [body('reason').notEmpty().trim()],
  validate,
  ctrl.terminateLead
)

router.put('/:leadId', ctrl.editLead)
router.put('/:leadId/assign',
  [body('employeeId').notEmpty()],
  validate,
  ctrl.assignLead
)

module.exports = router
