const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/account/payments.controller')
const validate = require('../../middleware/validate')
const { WIP_STATUSES } = require('../../models/WIPProfit')

const statusQuery = query('status')
  .optional({ checkFalsy: true })
  .isIn(['all', ...WIP_STATUSES, 'In progress', 'Started', 'Completed', 'in progress'])

router.get('/stats', ctrl.getStats)
router.get('/overview', ctrl.getPaymentOverview)
router.get(
  '/orders',
  [
    statusQuery,
    query('search').optional().trim(),
    query('period').optional().isIn(['today', 'week', 'month']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.getOrdersAndPayments
)

router.get('/orders/:orderId', [param('orderId').notEmpty()], validate, ctrl.getOrderDetail)

router.post(
  '/orders',
  [
    body('leadId').optional().isMongoId(),
    body('quoteOrderId').optional().trim(),
    body('orderValue').optional().isNumeric(),
    body('currentCost').optional().isNumeric(),
    body('depositPaid').optional().isNumeric(),
    body('progressPaid').optional().isNumeric(),
    body('finalPaid').optional().isNumeric(),
    body('status').optional().isIn(WIP_STATUSES),
  ],
  validate,
  ctrl.createOrderPayment
)

router.put(
  '/orders/:orderId',
  [
    param('orderId').notEmpty(),
    body('orderValue').optional().isNumeric(),
    body('currentCost').optional().isNumeric(),
    body('depositPaid').optional().isNumeric(),
    body('progressPaid').optional().isNumeric(),
    body('finalPaid').optional().isNumeric(),
    body('status').optional().isIn(WIP_STATUSES),
  ],
  validate,
  ctrl.updateOrderPayment
)

module.exports = router
