const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

const guard = [verifyToken, roleGuard(['admin', 'sales'])]

// Lead-scoped list routes
const quotationCtrl = require('../../controllers/common/quotation.controller')
const invoiceCtrl = require('../../controllers/common/invoice.controller')

router.get('/leads/:leadId/quotations', ...guard, quotationCtrl.getLeadQuotations)
router.get('/leads/:leadId/invoices', ...guard, invoiceCtrl.getLeadInvoices)

// Resource routes
router.use('/quotations', ...guard, require('./quotation.routes'))
router.use('/invoices', ...guard, require('./invoice.routes'))
router.use('/payment-schedules', ...guard, require('./payment.routes'))
router.use('/upload', ...guard, require('./upload.routes'))

module.exports = router
