const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/admin/customer.controller')
const leadCtrl = require('../../controllers/admin/lead.controller')
const agreementCtrl = require('../../controllers/common/agreement.controller')
const validate = require('../../middleware/validate')
const { projectFieldValidators, leadCreateFieldValidators } = require('../../utils/leadCreateValidators')

// ── Static routes BEFORE /:customerId ─────────────────────────────────────────
router.get('/stats', ctrl.getCustomerStats)

router.get(
  '/projects',
  [
    query('scope').optional().isIn(['total', 'active', 'completed', 'not-assigned']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getAdminProjectList
)

router.get(
  '/',
  [
    query('scope').optional().isIn(['total', 'active']),
    query('isActive').optional().isIn(['true', 'false']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getAllCustomers
)

router.post('/',
  [
    body('firstName').notEmpty().trim(),
    body('email').isEmail(),
    body('phone').notEmpty().trim(),
    body('countryCode').optional().trim(),
    ...projectFieldValidators,
    body('assignedSales').optional().isMongoId(),
  ],
  validate,
  ctrl.createCustomerWithLead
)

// ── Parameterised routes ───────────────────────────────────────────────────────
router.put('/:customerId',
  [
    body('firstName').optional().notEmpty().trim(),
    body('email').optional().isEmail(),
    body('phone').optional().notEmpty().trim(),
    body('countryCode').optional().trim(),
  ],
  validate,
  ctrl.updateCustomer
)

router.patch('/:customerId/deactivate', ctrl.deactivateCustomer)

router.get('/:customerId/invoices', ctrl.getCustomerInvoices)

router.get('/:customerId', ctrl.getCustomerDetail)

const projectInvoiceValidators = [
  param('customerId').isMongoId(),
  param('leadId').isMongoId(),
]

router.get(
  '/:customerId/projects/:leadId/invoices/stats',
  projectInvoiceValidators,
  validate,
  ctrl.getProjectInvoiceStats
)
router.get(
  '/:customerId/projects/:leadId/invoices',
  [
    ...projectInvoiceValidators,
    query('status').optional().isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getProjectInvoices
)

router.get('/:customerId/projects', ctrl.getCustomerProjects)
router.get('/:customerId/projects/:leadId/agreement', agreementCtrl.getProjectAgreement)
router.get('/:customerId/projects/:leadId', ctrl.getCustomerProject)

router.post('/:customerId/leads',
  [
    ...projectFieldValidators,
    body('assignedSales').optional().isMongoId(),
  ],
  validate,
  leadCtrl.createProjectForCustomer
)

module.exports = router
