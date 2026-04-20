const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/invoice.controller')
const validate = require('../../middleware/validate')

router.post('/',
  [
    body('leadId').notEmpty(),
    body('totalAmount').isNumeric(),
  ],
  validate,
  ctrl.createInvoice
)

router.get('/:invoiceId', ctrl.getInvoice)
router.put('/:invoiceId', ctrl.updateInvoice)
router.post('/:invoiceId/send', ctrl.sendInvoice)
router.put('/:invoiceId/mark-paid', ctrl.markAsPaid)

module.exports = router
