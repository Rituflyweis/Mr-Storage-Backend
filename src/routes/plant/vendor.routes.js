const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/plant/vendor.controller')
const validate = require('../../middleware/validate')
const { VENDOR_STATUSES, VENDOR_TYPES } = require('../../config/constants')

const addressValidator = [
  body('address.placeNumber').optional().trim(),
  body('address.streetAddress').optional().trim(),
  body('address.landmark').optional().trim(),
  body('address.city').optional().trim(),
  body('address.state').optional().trim(),
  body('address.postalCode').optional().trim(),
  body('address.gpsCoordinates.lat').optional().isFloat(),
  body('address.gpsCoordinates.lng').optional().isFloat(),
]

const documentValidator = [
  body('documents').optional().isArray(),
  body('documents.*.name').optional().trim().notEmpty(),
  body('documents.*.url').optional().trim().notEmpty(),
]

router.get('/',
  [
    query('search').optional().trim(),
    query('materialType').optional().trim(),
    query('status').optional().isIn(VENDOR_STATUSES),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getVendors
)

router.post('/',
  [
    body('vendorName').notEmpty().trim(),
    body('email').isEmail(),
    body('phone').optional().trim(),
    body('contactName').optional().trim(),
    body('vendorCode').optional().trim(),
    body('yearsWithCompany').optional().isFloat({ min: 0 }),
    body('serviceCategory').optional().trim(),
    body('vendorType').optional().isIn(VENDOR_TYPES),
    body('materialTypes').optional().isArray(),
    body('materialTypes.*').optional().trim(),
    body('internalNotes').optional().trim(),
    ...addressValidator,
    ...documentValidator,
  ],
  validate,
  ctrl.createVendor
)

router.get('/:vendorId',
  [param('vendorId').isMongoId()],
  validate,
  ctrl.getVendorDetail
)

router.put('/:vendorId',
  [
    param('vendorId').isMongoId(),
    body('vendorName').optional().trim().notEmpty(),
    body('email').optional().isEmail(),
    body('phone').optional().trim(),
    body('contactName').optional().trim(),
    body('vendorCode').optional().trim().notEmpty(),
    body('yearsWithCompany').optional().isFloat({ min: 0 }),
    body('serviceCategory').optional().trim(),
    body('vendorType').optional().isIn(VENDOR_TYPES),
    body('materialTypes').optional().isArray(),
    body('materialTypes.*').optional().trim(),
    body('internalNotes').optional().trim(),
    body('status').optional().isIn(VENDOR_STATUSES),
    ...addressValidator,
    ...documentValidator,
  ],
  validate,
  ctrl.updateVendor
)

router.patch('/:vendorId/toggle-status',
  [param('vendorId').isMongoId()],
  validate,
  ctrl.toggleVendorStatus
)

module.exports = router
