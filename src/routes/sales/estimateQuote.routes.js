const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/estimateQuote.controller')
const validate = require('../../middleware/validate')

router.post('/extract-drawing', [body('fileBase64').notEmpty()], validate, ctrl.extractDrawingPdf)
router.post('/extract-shipper', [body('fileBase64').notEmpty()], validate, ctrl.extractShipperFile)
router.post('/extract-storage-cog', [body('fileBase64').notEmpty()], validate, ctrl.extractStorageCog)

router.post('/compute', ctrl.computeQuote)
router.post('/compute-storage', ctrl.computeStorageQuote)
router.post('/cogs/preview', ctrl.previewCogsOverride)
router.post('/margin/preview', ctrl.previewMarginOverride)

router.get('/tax-lookup/:zip', ctrl.lookupTaxRate)
router.get('/tax-lookup', ctrl.lookupTaxRate)

router.post('/documents/preview', ctrl.previewDocuments)
router.post('/documents/pdf', ctrl.generateQuotePdf)
router.post('/:estimateId/documents/pdf', ctrl.generateQuotePdf)

router.get('/history/summary', ctrl.getQuoteHistorySummary)

router.get('/', ctrl.listEstimateQuotes)
router.post('/', ctrl.createEstimateQuote)
router.get('/:estimateId', ctrl.getEstimateQuote)
router.put('/:estimateId', ctrl.updateEstimateQuote)
router.delete('/:estimateId', ctrl.deleteEstimateQuote)

module.exports = router
