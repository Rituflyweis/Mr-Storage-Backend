const router = require('express').Router()
const { body } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/invoice.controller')

const updateInvoiceValidators = [
  body('totalAmount').optional().isNumeric(),
  body('date').optional().isISO8601(),
  body('daysToPay').optional().isNumeric(),
  body('paymentScheduleStageId').optional().isMongoId(),
]

router.get('/stats', [
  query('leadId').optional().isMongoId().withMessage('Invalid leadId'),
], ctrl.getInvoiceStats)
router.get('/export', ctrl.exportInvoices)
router.get('/', ctrl.listInvoices)
router.get('/:invoiceId', ctrl.getInvoice)
router.put('/:invoiceId', updateInvoiceValidators, validate, ctrl.updateInvoice)
router.post('/:invoiceId/send', ctrl.sendInvoice)
router.put('/:invoiceId/mark-paid', ctrl.markAsPaid)


module.exports = router
