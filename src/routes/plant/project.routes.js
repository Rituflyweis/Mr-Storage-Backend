const router = require('express').Router()
const { body, query, param } = require('express-validator')
const ctrl = require('../../controllers/plant/project.controller')
const bundleCtrl = require('../../controllers/plant/bundle.controller')
const bundlePlanCtrl = require('../../controllers/plant/bundlePlan.controller')
const packingListPlanCtrl = require('../../controllers/plant/packingListPlan.controller')
const deliveryCtrl = require('../../controllers/plant/delivery.controller')
const validate = require('../../middleware/validate')
const { PLANT_LIFECYCLE_STAGES, BOM_FILE_FORMATS, TRUCK_TYPES } = require('../../config/constants')
const {
  shipperRequestListQueryValidators,
} = require('../../validators/shipperListQuery.validators')

router.get('/stats',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getProjectStats
)

router.get('/',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('projectId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('buildingType').optional().trim(),
    query('drawingStatus').optional().isIn(['all_approved', 'pending', 'rejected', 'none']),
  ],
  validate,
  ctrl.getProjects
)

router.get('/:leadId/detail', ctrl.getProjectDetail)

router.put('/:leadId/lifecycle',
  [
    body('completeCurrentStep').optional().isBoolean(),
    body('lifecycleStatus').optional().isIn(PLANT_LIFECYCLE_STAGES),
    body('note').optional().trim(),
  ],
  validate,
  ctrl.updateProjectLifecycle
)

router.get('/:leadId/notes', ctrl.getProjectNotes)
router.post('/:leadId/notes',
  [body('note').notEmpty().trim()],
  validate,
  ctrl.createProjectNote
)

router.get('/:leadId/invoices', ctrl.getProjectInvoices)
router.get('/:leadId/buildings', ctrl.getProjectBuildings)
router.post('/:leadId/drawings',
  [
    body('drawings').isArray({ min: 1 }),
    body('drawings.*.buildingId').isMongoId(),
    body('drawings.*.fileUrl').notEmpty().trim(),
    body('drawings.*.fileName').notEmpty().trim(),
  ],
  validate,
  ctrl.uploadProjectDrawings
)
router.get('/:leadId/drawings', ctrl.getProjectDrawings)

const mediaCtrl = require('../../controllers/common/leadMedia.controller')
router.get('/:leadId/media',
  [query('type').optional().isIn(['photo', 'video'])],
  validate,
  mediaCtrl.getLeadMedia
)
router.post('/:leadId/media',
  [
    body('url').notEmpty(),
    body('name').notEmpty(),
    body('type').isIn(['photo', 'video']),
  ],
  validate,
  mediaCtrl.uploadLeadMedia
)

const drawingDocParams = [
  param('leadId').isMongoId(),
  param('docId').isMongoId(),
]
const drawingRevisionBody = [
  body('note').optional().isString().trim(),
  body('notes').optional().isString().trim(),
  body('reviewNotes').optional().isString().trim(),
  body('revisionNote').optional().isString().trim(),
]
const drawingReviewBody = [
  body('status').optional().isString().trim(),
  body('approvalStatus').optional().isString().trim(),
  ...drawingRevisionBody,
]

router.post('/:leadId/drawings/:docId/approve', drawingDocParams, validate, ctrl.approveProjectDrawing)
router.put('/:leadId/drawings/:docId/approve', drawingDocParams, validate, ctrl.approveProjectDrawing)
router.post('/:leadId/drawings/:docId/request-revision', [...drawingDocParams, ...drawingRevisionBody], validate, ctrl.requestProjectDrawingRevision)
router.post('/:leadId/drawings/:docId/reject', [...drawingDocParams, ...drawingRevisionBody], validate, ctrl.requestProjectDrawingRevision)
router.put('/:leadId/drawings/:docId/review', [...drawingDocParams, ...drawingReviewBody], validate, ctrl.reviewProjectDrawing)
router.post('/:leadId/drawings/:docId/review', [...drawingDocParams, ...drawingReviewBody], validate, ctrl.reviewProjectDrawing)

const invoiceCtrl = require('../../controllers/common/invoice.controller')
const assertInvoiceMatchesProjectParams = require('../../middleware/assertInvoiceProjectParams')
const paymentProofRejectValidators = [
  body('reviewNotes').optional().isString(),
  body('notes').optional().isString(),
  body('note').optional().isString(),
]
const projectInvoiceParams = [
  param('leadId').isMongoId(),
  param('invoiceId').isMongoId(),
]

router.put('/:leadId/invoices/:invoiceId/payment-proof/verify', projectInvoiceParams, validate, assertInvoiceMatchesProjectParams, invoiceCtrl.verifyPaymentProof)
router.post('/:leadId/invoices/:invoiceId/payment-proof/verify', projectInvoiceParams, validate, assertInvoiceMatchesProjectParams, invoiceCtrl.verifyPaymentProof)
router.put('/:leadId/invoices/:invoiceId/payment-proof/approve', projectInvoiceParams, validate, assertInvoiceMatchesProjectParams, invoiceCtrl.verifyPaymentProof)
router.post('/:leadId/invoices/:invoiceId/payment-proof/approve', projectInvoiceParams, validate, assertInvoiceMatchesProjectParams, invoiceCtrl.verifyPaymentProof)
router.put('/:leadId/invoices/:invoiceId/payment-proof/reject', [...projectInvoiceParams, ...paymentProofRejectValidators], validate, assertInvoiceMatchesProjectParams, invoiceCtrl.rejectPaymentProof)
router.post('/:leadId/invoices/:invoiceId/payment-proof/reject', [...projectInvoiceParams, ...paymentProofRejectValidators], validate, assertInvoiceMatchesProjectParams, invoiceCtrl.rejectPaymentProof)
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
router.get('/:leadId/bom-files', ctrl.getProjectBomFiles)
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
router.get('/:leadId/delivery', deliveryCtrl.getProjectConfirmedDelivery)
router.get('/:leadId/shipper-files',
  [param('leadId').isMongoId(), ...shipperRequestListQueryValidators],
  validate,
  ctrl.getProjectShipperFiles
)
router.get('/:leadId/bundle-plan', bundleCtrl.getProjectBundlePlan)

// Unified project-id based load/truck planning + freight endpoints (projectId = Mongo _id or jobId like PRO-019)
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
router.post('/:projectId/freight/send-bids',
  [
    body('carrierIds').isArray({ min: 1 }),
    body('carrierIds.*').isMongoId(),
    body('bidDeadline').optional().isISO8601(),
  ],
  validate,
  deliveryCtrl.sendDeliveryBidsByProject
)
router.get('/:projectId/freight/bids',
  [
    query('sort').optional().isIn(['low_to_high', 'high_to_low']),
  ],
  validate,
  deliveryCtrl.getDeliveryBidsByProject
)

module.exports = router
