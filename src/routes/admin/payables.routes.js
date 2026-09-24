const router = require('express').Router()
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/payables.controller')
const {
  createVendorPayableValidators,
  createFreightPayableValidators,
  commentValidators,
  rejectValidators,
  mongoId,
} = require('../../validators/payables.validators')

router.get('/filters', ctrl.payableFilterMeta)
router.get('/approval-queue', ctrl.listAdminPayablesQueue)

router.post('/vendor', createVendorPayableValidators, validate, ctrl.createVendorPayable)
router.post('/freight-carrier', createFreightPayableValidators, validate, ctrl.createFreightCarrierPayable)

router.get('/:invoiceId', mongoId, validate, ctrl.getPayableDetail)
router.put('/:invoiceId/approve', mongoId, validate, ctrl.approvePayable)
router.put('/:invoiceId/reject', rejectValidators, validate, ctrl.rejectPayable)
router.post('/:invoiceId/comments', commentValidators, validate, ctrl.addAdminPayableComment)

module.exports = router
