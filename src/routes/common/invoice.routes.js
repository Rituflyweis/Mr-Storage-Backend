const router = require('express').Router()
const { body, query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/invoice.controller')
const { invoiceBodyValidators } = require('../../utils/invoiceRouteValidators')

router.get('/stats', [
  query('leadId').optional().isMongoId().withMessage('Invalid leadId'),
], ctrl.getInvoiceStats)
router.get('/export', ctrl.exportInvoices)
router.get('/payment-proofs/pending', ctrl.getPendingPaymentProofs)
router.get('/', ctrl.listInvoices)
router.get('/:invoiceId', ctrl.getInvoice)
router.put('/:invoiceId', invoiceBodyValidators, validate, ctrl.updateInvoice)
router.post('/:invoiceId/send', ctrl.sendInvoice)
router.put('/:invoiceId/mark-paid', ctrl.markAsPaid)
router.put('/:invoiceId/payment-proof/verify', ctrl.verifyPaymentProof)
router.put('/:invoiceId/payment-proof/reject', [body('reviewNotes').optional().isString()], validate, ctrl.rejectPaymentProof)


module.exports = router
