const router = require('express').Router()
const { body, param } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/account/invoiceManagement.controller')

const listQuery = []

router.get('/filters', ctrl.getFilters)

router.get('/project/summary', listQuery, validate, ctrl.getProjectSummary)
router.get('/project/records', listQuery, validate, ctrl.listProjectRecords)
router.get('/project/export', listQuery, validate, ctrl.exportProjectRecords)

router.get('/vendor/summary', listQuery, validate, ctrl.getVendorSummary)
router.get('/vendor/records', listQuery, validate, ctrl.listVendorRecords)
router.get('/vendor/export', listQuery, validate, ctrl.exportVendorRecords)

router.get('/carrier/summary', listQuery, validate, ctrl.getCarrierSummary)
router.get('/carrier/records', listQuery, validate, ctrl.listCarrierRecords)
router.get('/carrier/export', listQuery, validate, ctrl.exportCarrierRecords)

router.get('/miscellaneous/summary', listQuery, validate, ctrl.getMiscellaneousSummary)
router.get('/miscellaneous/records', listQuery, validate, ctrl.listMiscellaneousRecords)
router.get('/miscellaneous/export', listQuery, validate, ctrl.exportMiscellaneousRecords)
router.post(
  '/miscellaneous',
  [
    body('amount').optional().isNumeric(),
    body('totalAmount').optional().isNumeric(),
    body('serviceProvider').optional().trim(),
    body('payeeName').optional().trim(),
    body('projectId').optional().isMongoId(),
    body('leadId').optional().isMongoId(),
  ],
  validate,
  ctrl.createMiscellaneousInvoice
)

router.get('/quotation-profit/summary', listQuery, validate, ctrl.getQuotationProfitSummary)
router.get('/quotation-profit/records', listQuery, validate, ctrl.listQuotationProfitRecords)
router.get('/quotation-profit/export', listQuery, validate, ctrl.exportQuotationProfitRecords)
router.get('/quotation-profit/:quotationId', [param('quotationId').isMongoId()], validate, ctrl.getQuotationProfitDetail)
router.post(
  '/quotation-profit/upload',
  [
    body('quotationId').optional().isMongoId(),
    body('leadId').optional().isMongoId(),
    body('revenue').optional().isNumeric(),
    body('actualCost').optional().isNumeric(),
    body('status').optional().isIn(['Profitable', 'Low Margin', 'Loss']),
  ],
  validate,
  ctrl.uploadQuotationProfit
)

module.exports = router
