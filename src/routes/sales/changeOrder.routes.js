const router = require('express').Router()
const ctrl = require('../../controllers/sales/changeOrder.controller')

router.post('/preview', ctrl.previewChangeOrder)
router.post('/pdf', ctrl.generateChangeOrderPdf)

router.get('/', ctrl.listChangeOrders)
router.post('/', ctrl.createChangeOrder)
router.put('/:coId', ctrl.updateChangeOrder)
router.delete('/:coId', ctrl.deleteChangeOrder)
router.post('/:coId/pdf', ctrl.generateChangeOrderPdf)

module.exports = router
