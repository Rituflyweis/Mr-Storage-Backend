const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/account/tax.controller')
const validate = require('../../middleware/validate')

router.get('/stats', ctrl.getStats)

router.get('/', ctrl.listTaxes)

router.post('/',
  [
    body('state').notEmpty(),
    body('dueDate').isISO8601(),
    body('amount').isNumeric(),
    body('filingFrequency').optional().isIn(['monthly', 'quarterly', 'annually', 'varies', 'local_only']),
    body('threshold').optional().isString(),
    body('websiteLink').optional().isURL().withMessage('Invalid websiteLink URL'),
  ],
  validate,
  ctrl.createTax
)

router.put('/:taxId/mark-paid', ctrl.markAsPaid)

module.exports = router
