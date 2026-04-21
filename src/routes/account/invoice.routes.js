const router = require('express').Router()
const ctrl = require('../../controllers/account/invoice.controller')

router.get('/',                          ctrl.getInvoices)
router.get('/analytics',                 ctrl.getAnalytics)
router.get('/project/:leadId/breakdown', ctrl.getProjectBreakdown)
router.put('/:invoiceId/mark-paid',      ctrl.markAsPaid)

module.exports = router
