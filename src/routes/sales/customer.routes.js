const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/customer.controller')
const validate = require('../../middleware/validate')

// ── Static routes BEFORE /:customerId ─────────────────────────────────────────
router.get('/stats', ctrl.getCustomerStats)
router.get('/', ctrl.getCustomers)

// ── Parameterised routes ───────────────────────────────────────────────────────
router.get('/:customerId', ctrl.getCustomerDetail)
router.get('/:customerId/projects', ctrl.getCustomerProjects)

router.post('/:customerId/projects',
  [
    body('projectName').notEmpty().trim(),
    body('buildingType').notEmpty().trim(),
    body('location').notEmpty().trim(),
  ],
  validate,
  ctrl.createProject
)

module.exports = router
