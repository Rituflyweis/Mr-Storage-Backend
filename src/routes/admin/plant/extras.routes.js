const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../../controllers/plant/extras.controller')
const validate = require('../../../middleware/validate')
const { FREIGHT_BID_STATUSES } = require('../../../config/constants')

// Savings
router.get('/savings',
  [query('projectId').optional().isMongoId()],
  validate,
  ctrl.getSavings
)
router.get('/savings/export',
  [
    query('projectId').optional().isMongoId(),
    query('status').optional().isIn(['Good', 'Over Budget']),
  ],
  validate,
  ctrl.exportSavings
)

// Freight Loads
router.get('/freight-loads/filters', ctrl.getFreightLoadFilters)

router.get('/freight-loads',
  [
    query('status').optional().isIn(FREIGHT_BID_STATUSES),
    query('carrierId').optional().isMongoId(),
    query('projectId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getFreightLoads
)

router.get('/awarded-loads',
  [
    query('carrierId').optional().isMongoId(),
    query('projectId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getAwardedLoads
)

// Deliveries
router.get('/deliveries-calendar', ctrl.getDeliveriesCalendar)
router.get('/all-deliveries',      ctrl.getAllDeliveries)

// QR Labels
router.get('/qr-labels', ctrl.getQRLabels)

// Item Cost List (Costing)
router.get('/costing',            ctrl.getItemCostList)
router.post('/costing',           [body('mbsCost').isNumeric()], validate, ctrl.createItemCost)
router.put('/costing/:itemId',    [param('itemId').isMongoId()], validate, ctrl.updateItemCost)

// Notification Details (delivery notification history)
router.get('/notification-details', ctrl.getNotificationDetails)

module.exports = router
