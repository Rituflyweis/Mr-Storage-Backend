const { body, param, query } = require('express-validator')
const { VENDOR_STATUSES, VENDOR_TYPES } = require('../config/constants')
const {
  normalizeVendorRequestBody,
  normalizeVendorType,
} = require('../utils/vendorRequestBody.util')

const normalizeVendorBody = (req, _res, next) => {
  req.body = normalizeVendorRequestBody(req.body || {})
  next()
}

const addressValidator = [
  body('address.placeNumber').optional({ values: 'falsy' }).trim(),
  body('address.streetAddress').optional({ values: 'falsy' }).trim(),
  body('address.landmark').optional({ values: 'falsy' }).trim(),
  body('address.city').optional({ values: 'falsy' }).trim(),
  body('address.state').optional({ values: 'falsy' }).trim(),
  body('address.postalCode').optional({ values: 'falsy' }).trim(),
  body('address.gpsCoordinates.lat')
    .optional({ values: 'null' })
    .custom((val) => val === null || val === undefined || Number.isFinite(Number(val))),
  body('address.gpsCoordinates.lng')
    .optional({ values: 'null' })
    .custom((val) => val === null || val === undefined || Number.isFinite(Number(val))),
]

const documentValidator = [
  body('documents').optional().isArray(),
  body('documents.*.name').optional().trim().notEmpty(),
  body('documents.*.url').optional().trim().notEmpty(),
]

const vendorTypeValidator = body('vendorType')
  .optional({ values: 'falsy' })
  .custom((value) => {
    if (value === undefined || value === null || value === '') return true
    const normalized = normalizeVendorType(value)
    if (!VENDOR_TYPES.includes(normalized)) {
      throw new Error(`vendorType must be one of: ${VENDOR_TYPES.join(', ')}`)
    }
    return true
  })

const yearsWithCompanyValidator = body('yearsWithCompany')
  .optional({ values: 'falsy' })
  .isFloat({ min: 0 })

const vendorListQueryValidators = [
  query('search').optional().trim(),
  query('materialType').optional().trim(),
  query('status').optional().isIn(VENDOR_STATUSES),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
]

const createVendorValidators = [
  normalizeVendorBody,
  body('vendorName').notEmpty().trim().withMessage('vendorName is required'),
  body('email').isEmail(),
  body('phone').optional({ values: 'falsy' }).trim(),
  body('contactName').optional({ values: 'falsy' }).trim(),
  body('vendorCode').optional({ values: 'falsy' }).trim(),
  yearsWithCompanyValidator,
  body('serviceCategory').optional({ values: 'falsy' }).trim(),
  vendorTypeValidator,
  body('materialTypes').optional().isArray(),
  body('materialTypes.*').optional().trim(),
  body('internalNotes').optional({ values: 'falsy' }).trim(),
  ...addressValidator,
  ...documentValidator,
]

const updateVendorValidators = [
  normalizeVendorBody,
  param('vendorId').isMongoId(),
  body('vendorName').optional({ values: 'falsy' }).trim().notEmpty(),
  body('email').optional({ values: 'falsy' }).isEmail(),
  body('phone').optional({ values: 'falsy' }).trim(),
  body('contactName').optional({ values: 'falsy' }).trim(),
  body('vendorCode').optional({ values: 'falsy' }).trim().notEmpty(),
  yearsWithCompanyValidator,
  body('serviceCategory').optional({ values: 'falsy' }).trim(),
  vendorTypeValidator,
  body('materialTypes').optional().isArray(),
  body('materialTypes.*').optional().trim(),
  body('internalNotes').optional({ values: 'falsy' }).trim(),
  body('status').optional().isIn(VENDOR_STATUSES),
  ...addressValidator,
  ...documentValidator,
]

module.exports = {
  normalizeVendorBody,
  vendorListQueryValidators,
  createVendorValidators,
  updateVendorValidators,
}
