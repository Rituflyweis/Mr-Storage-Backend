const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/plant/carrier.controller')
const validate = require('../../middleware/validate')
const { CARRIER_STATUSES } = require('../../config/constants')

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

const fleetValidator = [
  body('fleetEquipment').optional().isArray(),
  body('fleetEquipment.*.equipmentName').optional().trim().notEmpty(),
  body('fleetEquipment.*.quantity').optional().isFloat({ min: 0 }),
  body('fleetCapacity.totalVehicleCount').optional().isFloat({ min: 0 }),
  body('fleetCapacity.maximumLoadCapacity').optional().isFloat({ min: 0 }),
  body('fleetCapacity.averageFleetAge').optional().isFloat({ min: 0 }),
]

router.get('/',
  [
    query('search').optional().trim(),
    query('serviceType').optional().trim(),
    query('serviceArea').optional().trim(),
    query('equipmentType').optional().trim(),
    query('status').optional().isIn(CARRIER_STATUSES),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getCarriers
)

router.post('/',
  [
    body('carrierName').notEmpty().trim(),
    body('email').isEmail(),
    body('phone').optional().trim(),
    body('contactName').optional().trim(),
    body('carrierCode').optional().trim(),
    body('serviceType').optional().trim(),
    body('serviceArea').optional().trim(),
    body('internalNotes').optional().trim(),
    ...addressValidator,
    ...documentValidator,
    ...fleetValidator,
  ],
  validate,
  ctrl.createCarrier
)

router.get('/:carrierId',
  [param('carrierId').isMongoId()],
  validate,
  ctrl.getCarrierDetail
)

router.put('/:carrierId',
  [
    param('carrierId').isMongoId(),
    body('carrierName').optional().trim().notEmpty(),
    body('email').optional().isEmail(),
    body('phone').optional().trim(),
    body('contactName').optional().trim(),
    body('carrierCode').optional().trim().notEmpty(),
    body('serviceType').optional().trim(),
    body('serviceArea').optional().trim(),
    body('internalNotes').optional().trim(),
    body('status').optional().isIn(CARRIER_STATUSES),
    ...addressValidator,
    ...documentValidator,
    ...fleetValidator,
  ],
  validate,
  ctrl.updateCarrier
)

router.patch('/:carrierId/toggle-status',
  [param('carrierId').isMongoId()],
  validate,
  ctrl.toggleCarrierStatus
)

module.exports = router
