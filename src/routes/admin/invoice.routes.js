const router = require('express').Router()
const ctrl = require('../../controllers/admin/invoice.controller')

router.get('/management-stats',     ctrl.getInvoiceManagementStats)
router.get('/projects',             ctrl.getProjectsDropdown)
router.get('/report',               ctrl.getInvoiceReport)
router.get('/vendor',               ctrl.getVendorInvoices)
router.get('/freight-carrier',      ctrl.getFreightCarrierInvoices)

module.exports = router
