const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/plant/packingList.controller')
const validate = require('../../middleware/validate')
const { TRUCK_TYPES } = require('../../config/constants')

// Global packing list overview across all projects (must be registered before the :packingListId route below)
router.get('/projects', ctrl.getPackingListPlanProjects)
router.get('/export', ctrl.exportPackingListsExcel)

router.get('/:packingListId/download-pdf',
  [param('packingListId').isMongoId()],
  validate,
  ctrl.downloadPackingListPdf
)

router.get('/:packingListId',
  [param('packingListId').isMongoId()],
  validate,
  ctrl.getPackingList
)

router.put('/:packingListId',
  [
    param('packingListId').isMongoId(),
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
  ctrl.updatePackingList
)

module.exports = router
