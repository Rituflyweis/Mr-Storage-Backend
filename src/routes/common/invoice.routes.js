const router = require('express').Router()
const ctrl = require('../../controllers/common/invoice.controller')

router.get('/:invoiceId', ctrl.getInvoice)
router.put('/:invoiceId', ctrl.updateInvoice)
router.post('/:invoiceId/send', ctrl.sendInvoice)
router.put('/:invoiceId/mark-paid', ctrl.markAsPaid)

module.exports = router
