const router = require('express').Router()
const { param } = require('express-validator')
const ctrl = require('../../controllers/plant/packingListPlan.controller')
const validate = require('../../middleware/validate')

router.get('/:packingListPlanId',
  [param('packingListPlanId').isMongoId()],
  validate,
  ctrl.getPackingListPlan
)

router.post('/:packingListPlanId/confirm',
  [param('packingListPlanId').isMongoId()],
  validate,
  ctrl.confirmPackingListPlan
)

module.exports = router
