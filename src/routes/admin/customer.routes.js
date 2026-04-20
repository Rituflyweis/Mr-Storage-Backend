const router = require('express').Router()
const ctrl = require('../../controllers/admin/customer.controller')
const leadCtrl = require('../../controllers/admin/lead.controller')
const { body } = require('express-validator')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getAllCustomers)
router.get('/:customerId', ctrl.getCustomerDetail)
router.get('/:customerId/projects/:leadId', ctrl.getCustomerProject)

// Create new project (lead) for existing customer
router.post('/:customerId/leads',
  [body('buildingType').optional().trim(), body('location').optional().trim()],
  validate,
  leadCtrl.createProjectForCustomer
)

module.exports = router
