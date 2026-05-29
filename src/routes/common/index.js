const router = require('express').Router()
const { body } = require('express-validator')
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')
const validate = require('../../middleware/validate')

const guard = [verifyToken, roleGuard(['admin', 'sales'])]

// Lead-scoped list routes
const quotationCtrl = require('../../controllers/common/quotation.controller')
const invoiceCtrl = require('../../controllers/common/invoice.controller')

router.get('/leads/:leadId/quotations', ...guard, quotationCtrl.getLeadQuotations)
router.get('/leads/:leadId/invoices', ...guard, invoiceCtrl.getLeadInvoices)
router.post('/leads/:leadId/invoices',
  ...guard,
  [
    body('totalAmount').isNumeric(),
    body('date').optional().isISO8601(),
    body('daysToPay').optional().isNumeric(),
    body('paymentScheduleStageId').optional().isMongoId(),
  ],
  validate,
  invoiceCtrl.createInvoice
)

// Resource routes
router.use('/quotations', ...guard, require('./quotation.routes'))
router.use('/invoices', ...guard, require('./invoice.routes'))
router.use('/payment-schedules', ...guard, require('./payment.routes'))
router.use('/upload', ...guard, require('./upload.routes'))
router.use('/uploads', ...guard, require('./upload.routes'))

module.exports = router
