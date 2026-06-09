const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/plant/delivery.controller')
const validate = require('../../middleware/validate')

router.get('/project/:leadId',
  [param('leadId').isMongoId()],
  validate,
  ctrl.getProjectDeliveries
)

router.post('/',
  [
    body('leadId').isMongoId(),
    body('description').optional().isString().trim(),
    body('loadDescription').optional().isString().trim(),
    body('weight').optional({ nullable: true }).isFloat({ min: 0 }),
    body('dimensions').optional().isObject(),
    body('dimensions.lengthFeet').optional({ nullable: true }).isFloat({ min: 0 }),
    body('dimensions.widthFeet').optional({ nullable: true }).isFloat({ min: 0 }),
    body('dimensions.heightFeet').optional({ nullable: true }).isFloat({ min: 0 }),
    body('metalType').optional().isString().trim(),
    body('packageCount').optional({ nullable: true }).isInt({ min: 0 }),
    body('loadingEquipment').optional().isArray(),
    body('loadingEquipment.*').optional().isString().trim(),
    body('bidDeadline').optional({ nullable: true }).isISO8601(),
    body('documentUrl').optional().isString().trim(),
    body('pickupLocation').optional().isString().trim(),
    body('pickupLocationData').optional().isObject(),
    body('pickupLocationData.address').optional().isString().trim(),
    body('pickupLocationData.coordinates.lat').optional({ nullable: true }).isFloat(),
    body('pickupLocationData.coordinates.lng').optional({ nullable: true }).isFloat(),
    body('deliveryLocation').optional().isString().trim(),
    body('deliveryLocationData').optional().isObject(),
    body('deliveryLocationData.address').optional().isString().trim(),
    body('deliveryLocationData.coordinates.lat').optional({ nullable: true }).isFloat(),
    body('deliveryLocationData.coordinates.lng').optional({ nullable: true }).isFloat(),
    body('pickupDate').optional({ nullable: true }).isISO8601(),
    body('pickupTime').optional().isString().trim(),
    body('deliveryDate').optional({ nullable: true }).isISO8601(),
    body('deliveryTime').optional().isString().trim(),
    body('timings').optional().isString().trim(),
    body('receivingPoc').optional().isString().trim(),
    body('pickupContactPhone').optional().isString().trim(),
    body('specialRequirements').optional().isString().trim(),
    body('additionalNotes').optional().isString().trim(),
  ],
  validate,
  ctrl.createDelivery
)

router.post('/:deliveryId/send-bids',
  [
    param('deliveryId').isMongoId(),
    body('carrierIds').isArray({ min: 1 }),
    body('carrierIds.*').isMongoId(),
    body('bidDeadline').optional().isISO8601(),
  ],
  validate,
  ctrl.sendDeliveryBids
)

router.get('/:deliveryId/bids',
  [
    param('deliveryId').isMongoId(),
    query('sort').optional().isIn(['low_to_high', 'high_to_low']),
  ],
  validate,
  ctrl.getDeliveryBids
)

module.exports = router
