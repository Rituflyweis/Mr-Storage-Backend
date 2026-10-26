const router = require('express').Router()
const multer = require('multer')
const { body, query, param } = require('express-validator')

const leadImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname?.toLowerCase().endsWith('.xlsx')
    cb(ok ? null : new Error('Only .xlsx Excel files are supported'), ok)
  },
})
const { LEAD_TEMPERATURES, LIFECYCLE_STAGES } = require('../../config/constants')
const ctrl = require('../../controllers/admin/lead.controller')
const chatCtrl = require('../../controllers/common/chatLifecycle.controller')
const agreementCtrl = require('../../controllers/common/agreement.controller')
const validate = require('../../middleware/validate')
const { leadCreateFieldValidators, leadEditFieldValidators } = require('../../utils/leadCreateValidators')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')

const businessUnitQuery = [businessUnitQueryValidator(), validate]

// ── Static routes BEFORE /:leadId ─────────────────────────────────────────────
router.get('/stats', ctrl.getLeadStats)
router.get('/ai-handled', businessUnitQuery, ctrl.getAiHandledLeads)
router.get('/signed-contracts', businessUnitQuery, ctrl.getSignedContracts)
router.get('/terminated', businessUnitQuery, ctrl.getTerminatedLeads)
router.get('/archived', businessUnitQuery, ctrl.getArchivedLeads)
router.get('/scoring/today', ctrl.getScoringToday)
router.get('/by-score',
  [
    businessUnitQueryValidator(),
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
router.post('/import', leadImportUpload.single('file'), ctrl.importLeads)
router.get('/export/excel', businessUnitQuery, ctrl.exportLeadsExcel)

router.get('/', businessUnitQuery, ctrl.getAllLeads)
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
router.get('/:leadId/chat-status', chatCtrl.getChatStatus)
router.put('/:leadId/chat/end', chatCtrl.endChat)
router.put('/:leadId/chat/reopen', chatCtrl.reopenChat)

router.get('/:leadId/agreement', agreementCtrl.getLeadAgreement)
router.get('/:leadId/detail', ctrl.getLeadDetail)
router.get('/:leadId/timeline', ctrl.getLeadTimeline)
router.get('/:leadId/documents',
  [query('type').optional().isIn(['drawing', 'approval', 'general', 'contract', 'photo', 'video', 'other'])],
  validate,
  ctrl.getLeadDocuments
)
const mediaCtrl = require('../../controllers/common/leadMedia.controller')
router.get('/:leadId/media',
  [query('type').optional().isIn(['photo', 'video'])],
  validate,
  mediaCtrl.getLeadMedia
)
router.post('/:leadId/media',
  [
    body('url').notEmpty(),
    body('name').notEmpty(),
    body('type').isIn(['photo', 'video']),
  ],
  validate,
  mediaCtrl.uploadLeadMedia
)
router.get('/:leadId/notes', ctrl.getLeadNotes)
router.post('/:leadId/notes',
  [body('note').notEmpty().trim()],
  validate,
  ctrl.createLeadNote
)
router.put('/:leadId/notes/:noteId',
  [body('note').notEmpty().trim()],
  validate,
  ctrl.updateLeadNote
)
router.delete('/:leadId/notes/:noteId', ctrl.deleteLeadNote)
router.use('/:leadId/structural-drawing', require('../common/structuralDrawing.routes'))
router.get('/:leadId/budget', ctrl.getLeadBudget)

const budgetCustomLineBody = [
  body('key').optional().trim().isString(),
  body('label').optional().trim().isString(),
  body('amount').optional().isNumeric(),
  body('expenseCategories').optional().isArray(),
]

router.post('/:leadId/budget',
  [
    body('materialBudget').optional().isNumeric(),
    body('logisticBudget').optional().isNumeric(),
    body('productionBudget').optional().isNumeric(),
    body('shipperBudget').optional().isNumeric(),
    body('otherCost').optional().isNumeric(),
    body('customLines').optional().isArray(),
    body('customLines.*.key').optional().trim().isString(),
    body('customLines.*.label').optional().trim().isString(),
    body('customLines.*.amount').optional().isNumeric(),
    body('customLines.*.expenseCategories').optional().isArray(),
  ],
  validate,
  ctrl.setLeadBudget
)

router.put(
  '/:leadId/budget/categories/:categoryKey',
  [body('amount').isNumeric(), param('categoryKey').isIn(['material', 'logistic', 'production', 'shipper', 'other'])],
  validate,
  ctrl.updateBudgetPresetCategory
)

router.post('/:leadId/budget/custom-lines', [...budgetCustomLineBody, body('label').notEmpty().trim()], validate, ctrl.addBudgetCustomLine)

router.put('/:leadId/budget/custom-lines/:lineKey', budgetCustomLineBody, validate, ctrl.updateBudgetCustomLine)

router.delete('/:leadId/budget/custom-lines/:lineKey', ctrl.deleteBudgetCustomLine)

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

router.put('/:leadId/archive',
  [body('reason').optional().trim()],
  validate,
  ctrl.archiveLead
)

router.put('/:leadId/unarchive', ctrl.unarchiveLead)

router.delete('/:leadId', ctrl.deleteLead)

router.put('/:leadId/temperature',
  [body('temperature').isIn(LEAD_TEMPERATURES)],
  validate,
  ctrl.updateLeadTemperature
)

router.put('/:leadId/lifecycle',
  [
    body('completeCurrentStep').optional().isBoolean(),
    body('lifecycleStatus').optional().isIn(LIFECYCLE_STAGES),
    body('note').optional().trim(),
  ],
  validate,
  ctrl.updateLifecycle
)

router.put('/:leadId', leadEditFieldValidators, validate, ctrl.editLead)
router.put('/:leadId/assign',
  [body('employeeId').notEmpty()],
  validate,
  ctrl.assignLead
)

module.exports = router
