const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../../middleware/validate')
const ctrl = require('../../../controllers/admin/plantDashboard.controller')

const dateRangeValidators = [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('assignedTo').optional().isMongoId(),
  query('employeeId').optional().isMongoId(),
  query('plantEmployeeId').optional().isMongoId(),
]

router.get('/order-progress-review', dateRangeValidators, validate, ctrl.getOrderProgressReview)
router.get('/load-planning-status', dateRangeValidators, validate, ctrl.getLoadPlanningStatus)
router.get('/mismatch-summary', dateRangeValidators, validate, ctrl.getMismatchSummary)
router.get('/missing-mismatch-summary', dateRangeValidators, validate, ctrl.getMismatchSummary)
router.get(
  '/mismatch-report',
  [
    ...dateRangeValidators,
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().trim(),
    query('category').optional().isIn(['missing', 'qty', 'spec', 'extra']),
  ],
  validate,
  ctrl.getMismatchReport,
)
router.get('/export', dateRangeValidators, validate, ctrl.exportPlantOverview)
router.get('/overview/export', dateRangeValidators, validate, ctrl.exportPlantOverview)
router.get('/shipper-quotation-summary', dateRangeValidators, validate, ctrl.getShipperQuotationSummary)
router.get('/packing-list-summary', dateRangeValidators, validate, ctrl.getPackingListSummary)
router.get('/qr-labels-summary', dateRangeValidators, validate, ctrl.getQrLabelsSummary)
router.get('/shippers-summary', dateRangeValidators, validate, ctrl.getShippersSummary)
router.get('/deliveries-summary', dateRangeValidators, validate, ctrl.getDeliveriesSummary)

router.get(
  '/upcoming-shipments',
  [
    ...dateRangeValidators,
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('status').optional().isString().trim(),
    query('search').optional().isString().trim(),
    query('fromDate').optional().isISO8601(),
    query('toDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getUpcomingShipments
)

module.exports = router
