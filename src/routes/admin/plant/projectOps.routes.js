const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../../controllers/plant/project.controller')
const bundlePlanCtrl = require('../../../controllers/plant/bundlePlan.controller')
const packingListPlanCtrl = require('../../../controllers/plant/packingListPlan.controller')
const deliveryCtrl = require('../../../controllers/plant/delivery.controller')
const validate = require('../../../middleware/validate')
const { BOM_FILE_FORMATS, TRUCK_TYPES } = require('../../../config/constants')

router.get('/:leadId/buildings', ctrl.getProjectBuildings)
router.get('/:leadId/bom-files', ctrl.getProjectBomFiles)
router.post('/:leadId/bom',
  [
    body('bomFiles').isArray({ min: 1 }),
    body('bomFiles.*.buildingId').isMongoId(),
    body('bomFiles.*.fileUrl').notEmpty().trim(),
    body('bomFiles.*.fileName').notEmpty().trim(),
    body('bomFiles.*.fileFormat').optional().isIn(BOM_FILE_FORMATS),
  ],
  validate,
  ctrl.uploadProjectBom
)
router.post('/:leadId/consolidated-bom/generate', ctrl.generateConsolidatedBOM)
router.get('/:leadId/consolidated-bom', ctrl.getConsolidatedBOM)
router.post('/:leadId/consolidated-bom/send',
  [
    body('vendorIds').isArray({ min: 1 }),
    body('vendorIds.*').isMongoId(),
  ],
  validate,
  ctrl.sendConsolidatedBOM
)
router.get('/:leadId/shipper-files', ctrl.getProjectShipperFiles)

router.get('/:projectId/load-planning', bundlePlanCtrl.getProjectLoadPlanning)
router.put('/:projectId/load-planning',
  [
    body('bundlePlanNotes').optional().isString().trim(),
    body('packingListPlanNotes').optional().isString().trim(),
    body('bundleUpdates').optional().isArray(),
    body('bundleUpdates.*.bundleId').optional().isMongoId(),
    body('bundleUpdates.*.loadSequence').optional({ nullable: true }).isInt({ min: 1 }),
    body('bundleUpdates.*.notes').optional().isString().trim(),
    body('bundleUpdates.*.handlingInstruction').optional().isString().trim(),
    body('packingListUpdates').optional().isArray(),
    body('packingListUpdates.*.packingListId').optional().isMongoId(),
    body('packingListUpdates.*.notes').optional().isString().trim(),
    body('packingListUpdates.*.loadingNotes').optional().isString().trim(),
  ],
  validate,
  bundlePlanCtrl.updateProjectLoadPlanning
)
router.get('/:projectId/load-planning/coverage', bundlePlanCtrl.getProjectBundlePlanCoverage)
router.post('/:projectId/load-planning/confirm-bundles', bundlePlanCtrl.confirmProjectBundlePlan)
router.post('/:projectId/load-planning/generate-truck-plan', bundlePlanCtrl.generateProjectPackingListPlan)
router.get('/:projectId/load-planning/truck-plan', packingListPlanCtrl.getProjectPackingListPlan)
router.post('/:projectId/load-planning/truck-plan/confirm', packingListPlanCtrl.confirmProjectPackingListPlan)
router.put('/:projectId/load-planning/trucks/:packingListId',
  [
    body('truckType').optional().isIn(TRUCK_TYPES),
    body('bundleIds').optional().isArray(),
    body('bundleIds.*').optional().isMongoId(),
    body('loadLayout').optional().isObject(),
    body('loadLayout.bottomLayerBundleIds').optional().isArray(),
    body('loadLayout.middleLayerBundleIds').optional().isArray(),
    body('loadLayout.topLayerBundleIds').optional().isArray(),
    body('loadLayout.loadingNotes').optional().isString().trim(),
    body('loadingNotes').optional().isString().trim(),
    body('overrideReason').optional().isString().trim(),
    body('notes').optional().isString().trim(),
  ],
  validate,
  packingListPlanCtrl.updateProjectPackingList
)
router.get('/:projectId/freight-autofill', deliveryCtrl.getFreightAutofillByProject)

module.exports = router
