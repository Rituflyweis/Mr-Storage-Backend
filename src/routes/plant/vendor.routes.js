const router = require('express').Router()
const { param } = require('express-validator')
const ctrl = require('../../controllers/plant/vendor.controller')
const validate = require('../../middleware/validate')
const {
  vendorListQueryValidators,
  createVendorValidators,
  updateVendorValidators,
} = require('../../validators/vendor.validators')

router.get('/', vendorListQueryValidators, validate, ctrl.getVendors)

router.post('/', createVendorValidators, validate, ctrl.createVendor)

router.get('/:vendorId',
  [param('vendorId').isMongoId()],
  validate,
  ctrl.getVendorDetail
)

router.patch('/:vendorId/toggle-status',
  [param('vendorId').isMongoId()],
  validate,
  ctrl.toggleVendorStatus
)

router.put('/:vendorId', updateVendorValidators, validate, ctrl.updateVendor)
router.patch('/:vendorId', updateVendorValidators, validate, ctrl.updateVendor)

module.exports = router
