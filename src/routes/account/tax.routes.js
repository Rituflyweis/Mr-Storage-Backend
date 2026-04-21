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
  ],
  validate,
  ctrl.createTax
)

router.put('/:taxId/mark-paid', ctrl.markAsPaid)

module.exports = router
