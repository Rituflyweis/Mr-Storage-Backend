const router = require('express').Router()
const ctrl = require('../../controllers/sales/customQuote.controller')

router.post('/preview', ctrl.previewCustomQuote)
router.post('/pdf', ctrl.generateCustomQuotePdf)

router.get('/', ctrl.listCustomQuotes)
router.post('/', ctrl.createCustomQuote)
router.get('/:id', ctrl.getCustomQuote)
router.get('/:id/preview', ctrl.previewCustomQuoteDocument)
router.post('/:id/preview', ctrl.previewCustomQuoteDocument)
router.put('/:id', ctrl.updateCustomQuote)
router.delete('/:id', ctrl.deleteCustomQuote)
router.post('/:id/pdf', ctrl.generateCustomQuotePdf)

module.exports = router
