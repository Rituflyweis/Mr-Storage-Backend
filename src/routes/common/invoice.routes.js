const router = require('express').Router()
const { body, query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/invoice.controller')
const { invoiceBodyValidators } = require('../../utils/invoiceRouteValidators')
const {
  outboundSendBodyValidators,
  markSentBodyValidators,
} = require('../../utils/outboundEmailRouteValidators')

router.get('/stats', [
  query('leadId').optional().isMongoId().withMessage('Invalid leadId'),
], ctrl.getInvoiceStats)
router.get('/export', ctrl.exportInvoices)
router.get('/payment-proofs/pending', ctrl.getPendingPaymentProofs)
router.get('/approval/pending', ctrl.getPendingInvoiceApprovals)
router.get(
  '/',
  [
    query('pending').optional().isIn(['true', 'false', '1', '0', 'yes', 'no', 'y', 'n']),
  ],
  validate,
  ctrl.listInvoices
)
router.get('/:invoiceId', ctrl.getInvoice)
router.put('/:invoiceId', invoiceBodyValidators, validate, ctrl.updateInvoice)
router.post('/:invoiceId/submit-approval', [body('note').optional().isString()], validate, ctrl.submitInvoiceForApproval)
router.put('/:invoiceId/approve', [body('note').optional().isString()], validate, ctrl.approveInvoice)
router.put('/:invoiceId/reject', [body('reason').optional().isString(), body('note').optional().isString()], validate, ctrl.rejectInvoice)
router.post('/:invoiceId/send', outboundSendBodyValidators, validate, ctrl.sendInvoice)
router.post('/:invoiceId/mark-sent', markSentBodyValidators, validate, ctrl.markInvoiceSent)

// Tax (Avalara) — preview estimate, adjust/void, and read persisted breakdown (spec §7, §9)
router.post('/:invoiceId/tax-preview', ctrl.previewInvoiceTax)
router.post(
  '/:invoiceId/tax-adjust',
  [body('action').optional().isIn(['adjust', 'void']), body('reason').optional().isString()],
  validate,
  ctrl.adjustInvoiceTax
)
router.get('/:invoiceId/tax', ctrl.getInvoiceTax)
router.put('/:invoiceId/mark-paid', ctrl.markAsPaid)
const paymentProofRejectValidators = [
  body('reviewNotes').optional().isString(),
  body('notes').optional().isString(),
  body('note').optional().isString(),
]

router.put('/:invoiceId/payment-proof/verify', ctrl.verifyPaymentProof)
router.post('/:invoiceId/payment-proof/verify', ctrl.verifyPaymentProof)
router.put('/:invoiceId/payment-proof/approve', ctrl.verifyPaymentProof)
router.post('/:invoiceId/payment-proof/approve', ctrl.verifyPaymentProof)
router.put('/:invoiceId/payment-proof/reject', paymentProofRejectValidators, validate, ctrl.rejectPaymentProof)
router.post('/:invoiceId/payment-proof/reject', paymentProofRejectValidators, validate, ctrl.rejectPaymentProof)


module.exports = router
