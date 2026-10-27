const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/estimateQuote.controller')
const extras = require('../../controllers/sales/quotingExtras.controller')
const validate = require('../../middleware/validate')

router.post('/extract-drawing', [body('fileBase64').notEmpty()], validate, ctrl.extractDrawingPdf)
router.post('/extract-shipper', [body('fileBase64').notEmpty()], validate, ctrl.extractShipperFile)
router.post('/extract-storage-cog', [body('fileBase64').notEmpty()], validate, ctrl.extractStorageCog)

router.post('/compute', ctrl.computeQuote)
router.post('/compute-storage', ctrl.computeStorageQuote)
router.post('/cogs/preview', ctrl.previewCogsOverride)
router.post('/margin/preview', ctrl.previewMarginOverride)
router.post('/deposit/preview', extras.previewDeposit)
router.post('/milestones/preview', extras.previewMilestones)
router.post('/staircase/preview', extras.previewStaircase)

router.get('/tax-lookup/:zip', ctrl.lookupTaxRate)
router.get('/tax-lookup', ctrl.lookupTaxRate)
router.get('/users', extras.listQuotingUsers)

router.post('/documents/preview', ctrl.previewDocuments)
router.post('/documents/pdf', ctrl.generateQuotePdf)
router.post('/documents/deposit-receipt/pdf', extras.depositReceiptPdf)
router.post('/documents/milestones/pdf', extras.milestonesPdf)
router.post('/:estimateId/documents/pdf', ctrl.generateQuotePdf)

router.get('/history/summary', ctrl.getQuoteHistorySummary)

router.get('/', ctrl.listEstimateQuotes)
router.post('/', ctrl.createEstimateQuote)
router.get('/:estimateId', ctrl.getEstimateQuote)
router.put('/:estimateId', ctrl.updateEstimateQuote)
router.delete('/:estimateId', ctrl.deleteEstimateQuote)
router.put('/:estimateId/deposit', extras.updateEstimateDeposit)
router.put('/:estimateId/milestones', extras.updateEstimateMilestones)
router.put('/:estimateId/multi-story', extras.updateEstimateMultiStory)

module.exports = router
