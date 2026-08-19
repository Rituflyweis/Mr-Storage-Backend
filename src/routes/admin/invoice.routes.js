const router = require('express').Router()
const ctrl = require('../../controllers/admin/invoice.controller')

router.get('/management-stats',     ctrl.getInvoiceManagementStats)
router.get('/projects',             ctrl.getProjectsDropdown)
router.get('/report',               ctrl.getInvoiceReport)
router.get('/vendor',               ctrl.getVendorInvoices)
router.get('/vendor/export',        ctrl.exportVendorInvoices)
router.get('/freight-carrier',      ctrl.getFreightCarrierInvoices)
router.get('/freight-carrier/export', ctrl.exportFreightCarrierInvoices)

// Individual Invoice detail screen — param routes last so they don't shadow the static ones above.
router.get('/:invoiceId',            ctrl.getInvoiceDetail)
router.get('/:invoiceId/export',     ctrl.exportInvoiceDetail)
router.put('/:invoiceId/mark-paid',  ctrl.markInvoicePaid)

module.exports = router
