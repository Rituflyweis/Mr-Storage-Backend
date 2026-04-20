const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/po.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getAllPOOrders)
router.put('/:poOrderId/status',
  [body('status').isIn(['approved', 'rejected'])],
  validate,
  ctrl.updatePOStatus
)

module.exports = router
