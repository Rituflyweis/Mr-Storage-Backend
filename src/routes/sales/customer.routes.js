const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/customer.controller')
const agreementCtrl = require('../../controllers/common/agreement.controller')
const validate = require('../../middleware/validate')
const { projectFieldValidators } = require('../../utils/leadCreateValidators')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')
const { CUSTOMER_DOCUMENT_CATEGORIES } = require('../../config/constants')
const customerDocCtrl = require('../../controllers/common/customerDocument.controller')

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

router.get('/:customerId/documents', customerDocCtrl.listCustomerDocuments)
router.post(
  '/:customerId/documents',
  [
    body('name').notEmpty().trim(),
    body('fileUrl').notEmpty().trim(),
    body('fileType').optional().isString().trim(),
    body('fileSize').optional().isNumeric(),
    body('category').optional().isIn(CUSTOMER_DOCUMENT_CATEGORIES),
    body('notes').optional().isString().trim(),
  ],
  validate,
  customerDocCtrl.addCustomerDocument
)
router.delete('/:customerId/documents/:docId', customerDocCtrl.deleteCustomerDocument)

router.get('/:customerId', ctrl.getCustomerDetail)
router.get('/:customerId/projects', [businessUnitQueryValidator()], validate, ctrl.getCustomerProjects)
router.get('/:customerId/projects/:leadId/agreement', agreementCtrl.getProjectAgreement)

router.post('/:customerId/projects', projectFieldValidators, validate, ctrl.createProject)

module.exports = router
