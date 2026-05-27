const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/customer.controller')
const validate = require('../../middleware/validate')
const { projectFieldValidators } = require('../../utils/leadCreateValidators')

// ── Static routes BEFORE /:customerId ─────────────────────────────────────────
router.get('/stats', ctrl.getCustomerStats)
router.get('/', ctrl.getCustomers)

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

router.get('/:customerId', ctrl.getCustomerDetail)
router.get('/:customerId/projects', ctrl.getCustomerProjects)

router.post('/:customerId/projects', projectFieldValidators, validate, ctrl.createProject)

module.exports = router
