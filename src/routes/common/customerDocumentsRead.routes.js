const router = require('express').Router()
const customerDocCtrl = require('../../controllers/common/customerDocument.controller')

router.get('/:customerId/documents', customerDocCtrl.listCustomerDocuments)

module.exports = router
