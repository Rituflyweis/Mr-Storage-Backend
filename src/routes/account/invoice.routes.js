const router = require('express').Router()
const { param, body } = require('express-validator')
const ctrl = require('../../controllers/account/invoice.controller')
const validate = require('../../middleware/validate')

const invoiceIdParam = param('invoiceId').isMongoId()

router.get('/',                          ctrl.getInvoices)
router.get('/analytics',                 ctrl.getAnalytics)
router.get('/project/:leadId/breakdown', ctrl.getProjectBreakdown)
router.get('/:invoiceId/pdf',            invoiceIdParam, validate, ctrl.downloadInvoicePdf)
router.put('/:invoiceId/mark-paid',      invoiceIdParam, validate, ctrl.markAsPaid)
router.post(
  '/:invoiceId/follow-up',
  [
    invoiceIdParam,
    body('message').optional().isString().trim(),
    body('subject').optional().isString().trim(),
    body('nextFollowUp').optional().isISO8601(),
  ],
  validate,
  ctrl.followUpInvoice
)


module.exports = router
