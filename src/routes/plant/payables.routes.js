const router = require('express').Router()
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/payables.controller')
const { plantPayablesListQuery, mongoId } = require('../../validators/payables.validators')

router.get('/filters', ctrl.payableFilterMeta)
router.get('/vendor', plantPayablesListQuery, validate, ctrl.listPlantVendorPayables)
router.get('/freight-carrier', plantPayablesListQuery, validate, ctrl.listPlantFreightCarrierPayables)
router.get('/:invoiceId', mongoId, validate, ctrl.getPlantPayableDetail)

module.exports = router
