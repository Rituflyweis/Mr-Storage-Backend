const router = require('express').Router()
const ctrl = require('../../controllers/sales/quotesStore.controller')

router.get('/quotes', ctrl.getQuotes)
router.put('/quotes/:id', ctrl.putQuote)
router.delete('/quotes/:id', ctrl.deleteQuote)

router.get('/change-orders', ctrl.getChangeOrders)
router.put('/change-orders/:id', ctrl.putChangeOrder)
router.delete('/change-orders/:id', ctrl.deleteChangeOrder)

module.exports = router
