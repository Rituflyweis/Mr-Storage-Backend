const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../../controllers/plant/bundlePlan.controller')
const deliveryCtrl = require('../../../controllers/plant/delivery.controller')
const validate = require('../../../middleware/validate')

const BUNDLE_TYPES = ['panels', 'trim', 'framing', 'fasteners', 'accessories', 'mixed', 'custom']

router.get('/:bundlePlanId',
  [param('bundlePlanId').isMongoId()],
  validate,
  ctrl.getBundlePlan
)

router.put('/:bundlePlanId',
  [param('bundlePlanId').isMongoId(), body('notes').optional().isString().trim()],
  validate,
  ctrl.updateBundlePlan
)

router.get('/:bundlePlanId/coverage',
  [param('bundlePlanId').isMongoId()],
  validate,
  ctrl.getBundlePlanCoverage
)

router.post('/:bundlePlanId/confirm',
  [param('bundlePlanId').isMongoId()],
  validate,
  ctrl.confirmBundlePlan
)

router.post('/:bundlePlanId/bundles',
  [
    param('bundlePlanId').isMongoId(),
    body('bundleType').optional().isIn(BUNDLE_TYPES),
    body('title').optional().isString().trim(),
    body('notes').optional().isString().trim(),
  ],
  validate,
  ctrl.createBundle
)

router.post('/:bundlePlanId/packing-list-plan/generate',
  [param('bundlePlanId').isMongoId()],
  validate,
  ctrl.generatePackingListPlan
)

router.get('/:bundlePlanId/freight-autofill',
  [param('bundlePlanId').isMongoId()],
  validate,
  deliveryCtrl.getFreightAutofill
)

module.exports = router
