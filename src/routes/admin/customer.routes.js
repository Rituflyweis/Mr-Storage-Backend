const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/customer.controller')
const leadCtrl = require('../../controllers/admin/lead.controller')
const validate = require('../../middleware/validate')

// ── Static routes BEFORE /:customerId ─────────────────────────────────────────
router.get('/stats', ctrl.getCustomerStats)

router.get('/', ctrl.getAllCustomers)

router.post('/',
  [
    body('firstName').notEmpty().trim(),
    body('email').isEmail(),
    body('phone').notEmpty().trim(),
    body('buildingType').notEmpty().trim(),
    body('location').notEmpty().trim(),
    body('projectName').notEmpty().trim(),
  ],
  validate,
  ctrl.createCustomerWithLead
)

// ── Parameterised routes ───────────────────────────────────────────────────────
router.get('/:customerId', ctrl.getCustomerDetail)
router.get('/:customerId/projects', ctrl.getCustomerProjects)
router.get('/:customerId/projects/:leadId', ctrl.getCustomerProject)

router.post('/:customerId/leads',
  [body('buildingType').optional().trim(), body('location').optional().trim()],
  validate,
  leadCtrl.createProjectForCustomer
)

module.exports = router
