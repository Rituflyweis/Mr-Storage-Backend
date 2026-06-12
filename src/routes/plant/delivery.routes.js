const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/plant/delivery.controller')
const validate = require('../../middleware/validate')

router.get('/project/:leadId',
  [param('leadId').isMongoId()],
  validate,
  ctrl.getProjectDeliveries
)

router.get('/freight/stats',
  validate,
  ctrl.getFreightLoadStats
)

router.get('/freight',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('status').optional().isString().trim(),
    query('projectId').optional().isString().trim(),
    query('carrierId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getFreightLoads
)

router.get('/awarded/stats',
  validate,
  ctrl.getAwardedLoadStats
)

router.get('/awarded',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('status').optional().isString().trim(),
    query('projectId').optional().isString().trim(),
    query('carrierId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getAwardedLoads
)

router.get('/calendar',
  [
    query('projectId').optional().isString().trim(),
    query('customerId').optional().isMongoId(),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getDeliveryCalendar
)

router.get('/stats',
  validate,
  ctrl.getAllDeliveryStats
)

router.get('/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('status').optional().isString().trim(),
    query('projectId').optional().isString().trim(),
    query('carrierId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getAllDeliveries
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

router.patch('/:deliveryId/status',
  [
    param('deliveryId').isMongoId(),
    body('status').isIn(['scheduled', 'confirmed', 'in_transit', 'delayed', 'delivered', 'cancelled']),
  ],
  validate,
  ctrl.updateDeliveryStatus
)

module.exports = router
