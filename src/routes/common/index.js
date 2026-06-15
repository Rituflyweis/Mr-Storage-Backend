const router = require('express').Router()
const { query } = require('express-validator')
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')
const validate = require('../../middleware/validate')
const { invoiceCreateValidators } = require('../../utils/invoiceRouteValidators')

const guard = [verifyToken, roleGuard(['admin', 'sales'])]
const lookupGuard = [verifyToken, roleGuard(['admin', 'sales', 'plant'])]
const uploadGuard = [verifyToken, roleGuard(['admin', 'sales', 'plant'])]
const smdtGuard = [verifyToken, roleGuard(['admin', 'plant'])]

const lookupValidators = [
  query('search').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
]

// Filter / dropdown lookups (admin all, sales/plant scoped)
const lookupCtrl = require('../../controllers/common/lookup.controller')
router.get('/customers', ...lookupGuard, lookupValidators, validate, lookupCtrl.listCustomers)
router.get('/leads', ...lookupGuard, lookupValidators, validate, lookupCtrl.listLeads)

// Lead-scoped list routes
const quotationCtrl = require('../../controllers/common/quotation.controller')
const invoiceCtrl = require('../../controllers/common/invoice.controller')

router.get('/leads/:leadId/quotations', ...guard, quotationCtrl.getLeadQuotations)
router.get('/leads/:leadId/invoices', ...guard, invoiceCtrl.getLeadInvoices)
router.post('/leads/:leadId/invoices',
  ...guard,
  invoiceCreateValidators,
  validate,
  invoiceCtrl.createInvoice
)

// Resource routes
router.use('/quotations', ...guard, require('./quotation.routes'))
router.use('/invoices', ...guard, require('./invoice.routes'))
router.use('/payment-schedules', ...guard, require('./payment.routes'))
router.use('/upload', uploadGuard, require('./upload.routes'))
router.use('/uploads', uploadGuard, require('./upload.routes'))
router.use('/smdt', smdtGuard, require('./smdt.routes'))

module.exports = router
