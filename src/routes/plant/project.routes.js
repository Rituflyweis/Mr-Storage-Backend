const router = require('express').Router()
const { body, query } = require('express-validator')
const ctrl = require('../../controllers/plant/project.controller')
const validate = require('../../middleware/validate')
const { PLANT_LIFECYCLE_STAGES } = require('../../config/constants')

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
  [body('lifecycleStatus').isIn(PLANT_LIFECYCLE_STAGES), body('note').optional().trim()],
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
router.get('/:leadId/bom-files', ctrl.getProjectBomFiles)
router.get('/:leadId/delivery', ctrl.getProjectDelivery)
router.get('/:leadId/shipper-files', ctrl.getProjectShipperFiles)

module.exports = router
