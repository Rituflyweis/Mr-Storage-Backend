const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/admin/po.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getAllPOOrders)
router.get(
  '/:poOrderId',
  [param('poOrderId').isMongoId()],
  validate,
  ctrl.getPOOrderDetail
)
router.put('/:poOrderId/status',
  [body('status').isIn(['approved', 'rejected'])],
  validate,
  ctrl.updatePOStatus
)
router.put('/:poOrderId/approve-and-assign',
  [body('assignedTo').notEmpty().isMongoId()],
  validate,
  ctrl.approveAndAssignPOOrder
)
router.put('/:poOrderId/assign',
  [body('assignedTo').notEmpty().isMongoId()],
  validate,
  ctrl.assignPOOrder
)

module.exports = router
