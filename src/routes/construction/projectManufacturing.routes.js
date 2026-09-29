const router = require('express').Router()
const { param, query } = require('express-validator')
const validate = require('../../middleware/validate')
const constructionPlantScope = require('../../middleware/constructionPlantScope')
const constructionPlantReadOnly = require('../../middleware/constructionPlantReadOnly')
const plantProjectCtrl = require('../../controllers/plant/project.controller')
const plantBomCtrl = require('../../controllers/plant/bom.controller')
const plantDeliveryCtrl = require('../../controllers/plant/delivery.controller')
const plantBundleCtrl = require('../../controllers/plant/bundle.controller')
const plantPackingListCtrl = require('../../controllers/plant/packingList.controller')
const plantPackingListPlanCtrl = require('../../controllers/plant/packingListPlan.controller')
const mediaCtrl = require('../../controllers/common/leadMedia.controller')
const scope = [constructionPlantScope, constructionPlantReadOnly]

const leadIdParam = [param('leadId').isMongoId(), validate]

const withProjectId = (req, _res, next) => {
  req.params.projectId = req.params.leadId
  next()
}

// —— View BOM ——
router.get('/:leadId/bom-files', ...scope, leadIdParam, plantProjectCtrl.getProjectBomFiles)
router.get('/:leadId/consolidated-bom', ...scope, leadIdParam, plantProjectCtrl.getConsolidatedBOM)
router.get('/:leadId/bom/consolidated-url', ...scope, leadIdParam, plantBomCtrl.getConsolidatedBOMUrl)
router.get(
  '/:leadId/bom/jobs/:jobId',
  ...scope,
  [param('leadId').isMongoId(), param('jobId').isMongoId(), validate],
  plantBomCtrl.getBOMJob
)
router.get(
  '/:leadId/bom/jobs/:jobId/status',
  ...scope,
  [param('leadId').isMongoId(), param('jobId').isMongoId(), validate],
  plantBomCtrl.getJobStatus
)

// —— View Drawings & Photos (manufacturing buildings + lead media) ——
router.get('/:leadId/building-drawings', ...scope, leadIdParam, plantProjectCtrl.getProjectDrawings)
router.get(
  '/:leadId/photos-videos',
  ...scope,
  [param('leadId').isMongoId(), query('type').optional().isIn(['photo', 'video']), validate],
  mediaCtrl.getLeadMedia
)

// —— Material delivery (plant freight for this project) ——
router.get('/:leadId/material-deliveries', ...scope, leadIdParam, plantDeliveryCtrl.getProjectDeliveries)
router.get(
  '/:leadId/material-deliveries/:deliveryId/detail',
  ...scope,
  [param('leadId').isMongoId(), param('deliveryId').isMongoId(), validate],
  plantDeliveryCtrl.getDeliveryDetail
)
router.get(
  '/:leadId/material-deliveries/:deliveryId/documents',
  ...scope,
  [param('leadId').isMongoId(), param('deliveryId').isMongoId(), validate],
  plantDeliveryCtrl.getDeliveryDocuments
)
router.get(
  '/:leadId/material-deliveries/:deliveryId/download',
  ...scope,
  [param('leadId').isMongoId(), param('deliveryId').isMongoId(), validate],
  plantDeliveryCtrl.downloadDeliveryDetailsPdf
)
router.get(
  '/:leadId/material-deliveries/:deliveryId/download/instructions',
  ...scope,
  [param('leadId').isMongoId(), param('deliveryId').isMongoId(), validate],
  plantDeliveryCtrl.downloadDeliveryInstructionsPdf
)
router.get(
  '/:leadId/material-deliveries/:deliveryId/download/packing-list',
  ...scope,
  [param('leadId').isMongoId(), param('deliveryId').isMongoId(), validate],
  plantDeliveryCtrl.downloadDeliveryPackingListPdf
)

// —— Bundles & packing (manufacturing) ——
router.get('/:leadId/bundle-plan', ...scope, leadIdParam, plantBundleCtrl.getProjectBundlePlan)
router.get(
  '/:leadId/bundles/:bundleId',
  ...scope,
  [param('leadId').isMongoId(), param('bundleId').isMongoId(), validate],
  plantBundleCtrl.getBundle
)
router.get('/:leadId/truck-plan', ...scope, leadIdParam, withProjectId, plantPackingListPlanCtrl.getProjectPackingListPlan)
router.get(
  '/:leadId/packing-lists/:packingListId',
  ...scope,
  [param('leadId').isMongoId(), param('packingListId').isMongoId(), validate],
  plantPackingListCtrl.getPackingList
)
router.get(
  '/:leadId/packing-lists/:packingListId/download-pdf',
  ...scope,
  [param('leadId').isMongoId(), param('packingListId').isMongoId(), validate],
  plantPackingListCtrl.downloadPackingListPdf
)

module.exports = router
