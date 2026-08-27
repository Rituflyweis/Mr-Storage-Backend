const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../../controllers/plant/extras.controller')
const validate = require('../../../middleware/validate')
const { FREIGHT_BID_STATUSES } = require('../../../config/constants')

// Savings
router.get('/savings',
  [query('projectId').optional({ checkFalsy: true }).isMongoId()],
  validate,
  ctrl.getSavings
)
router.get('/savings/export',
  [
    query('projectId').optional({ checkFalsy: true }).isMongoId(),
    query('status').optional({ checkFalsy: true }).isIn(['Good', 'Over Budget']),
  ],
  validate,
  ctrl.exportSavings
)

// Freight Loads
router.get('/freight-loads/filters', ctrl.getFreightLoadFilters)

router.get('/freight-loads',
  [
    query('status').optional({ checkFalsy: true }).isIn(FREIGHT_BID_STATUSES),
    query('carrierId').optional({ checkFalsy: true }).isMongoId(),
    query('projectId').optional({ checkFalsy: true }).isMongoId(),
    query('customerId').optional({ checkFalsy: true }).isMongoId(),
    query('materialType').optional({ checkFalsy: true }).trim(),
    query('siteLocation').optional({ checkFalsy: true }).trim(),
    query('startDate').optional({ checkFalsy: true }).isISO8601(),
    query('endDate').optional({ checkFalsy: true }).isISO8601(),
    query('search').optional().trim(),
    query('page').optional({ checkFalsy: true }).isInt({ min: 1 }),
    query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getFreightLoads
)

router.get('/awarded-loads',
  [
    query('carrierId').optional({ checkFalsy: true }).isMongoId(),
    query('projectId').optional({ checkFalsy: true }).isMongoId(),
    query('customerId').optional({ checkFalsy: true }).isMongoId(),
    query('startDate').optional({ checkFalsy: true }).isISO8601(),
    query('endDate').optional({ checkFalsy: true }).isISO8601(),
    query('search').optional().trim(),
    query('page').optional({ checkFalsy: true }).isInt({ min: 1 }),
    query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getAwardedLoads
)
router.get('/awarded-loads/export', ctrl.exportAwardedLoads)
router.get('/freight-loads/export', ctrl.exportFreightLoads)

// Deliveries
router.get('/deliveries-calendar', ctrl.getDeliveriesCalendar)
router.get('/all-deliveries',      ctrl.getAllDeliveries)

// QR Labels
router.get('/qr-labels', [query('search').optional().trim()], validate, ctrl.getQRLabels)
router.get('/qr-labels/export', ctrl.exportQRLabelsExcel)

// Item Cost List (Costing)
router.get('/costing',            ctrl.getItemCostList)
router.get('/costing/export',     ctrl.exportItemCostListExcel)
router.post('/costing',
  [body('category').notEmpty(), body('partName').notEmpty(), body('costUnit').notEmpty(), body('mbsCost').isNumeric()],
  validate,
  ctrl.createItemCost
)
router.put('/costing/:itemId',    [param('itemId').isMongoId()], validate, ctrl.updateItemCost)

// Notification Details (delivery notification history)
router.get('/notification-details', ctrl.getNotificationDetails)
router.get('/notification-details/export', ctrl.exportNotificationDetailsExcel)

module.exports = router
