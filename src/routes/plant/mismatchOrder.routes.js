const router = require('express').Router()
const { param, body } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/plant/mismatchOrder.controller')
const { MISMATCH_ORDER_STATUSES } = require('../../models/BundleMismatchOrder')

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
