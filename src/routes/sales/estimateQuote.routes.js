const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/estimateQuote.controller')
const validate = require('../../middleware/validate')

router.post('/extract-drawing', [body('fileBase64').notEmpty()], validate, ctrl.extractDrawingPdf)
router.post('/extract-shipper', [body('fileBase64').notEmpty()], validate, ctrl.extractShipperFile)

router.get('/history/summary', ctrl.getQuoteHistorySummary)

router.get('/', ctrl.listEstimateQuotes)
router.post('/', ctrl.createEstimateQuote)
router.get('/:estimateId', ctrl.getEstimateQuote)
router.put('/:estimateId', ctrl.updateEstimateQuote)
router.delete('/:estimateId', ctrl.deleteEstimateQuote)

module.exports = router
