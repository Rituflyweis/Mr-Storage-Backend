const router = require('express').Router()
const { param, body, query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/plant/mismatchOrder.controller')
const { MISMATCH_ORDER_STATUSES } = require('../../models/BundleMismatchOrder')

const listQueryValidators = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('status').optional().isIn([...MISMATCH_ORDER_STATUSES, 'All', 'all']),
  query('leadId').optional().isMongoId(),
  query('projectId').optional().isMongoId(),
  query('search').optional().trim(),
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
]

router.get('/', listQueryValidators, validate, ctrl.listAllMismatchOrders)

router.put('/:mismatchId/status',
  [
    param('mismatchId').isMongoId(),
    body('status').optional().isIn(MISMATCH_ORDER_STATUSES),
    body('actionNotes').optional().isString().trim(),
  ],
  validate,
  ctrl.updateMismatchOrderStatus
)

module.exports = router
