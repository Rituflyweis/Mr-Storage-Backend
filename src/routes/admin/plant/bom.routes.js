const router = require('express').Router()
const { body, query, param } = require('express-validator')
const ctrl = require('../../../controllers/plant/bom.controller')
const validate = require('../../../middleware/validate')
const { BOM_ITEM_FILTERS } = require('../../../config/constants')

router.post('/jobs/status',
  [body('jobIds').isArray({ min: 1 }), body('jobIds.*').isMongoId()],
  validate,
  ctrl.getJobsStatusBatch
)

router.get('/stats', ctrl.getBOMStats)

router.get('/projects',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getBOMProjectList
)

router.get('/projects/:leadId/consolidated-url',
  [param('leadId').isMongoId()],
  validate,
  ctrl.getConsolidatedBOMUrl
)

router.get('/consolidated',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('status').optional().isString(),
  ],
  validate,
  ctrl.getConsolidatedBOMList
)

router.get('/job/:jobId/status',
  [param('jobId').isMongoId()],
  validate,
  ctrl.getJobStatus
)

router.get('/:jobId',
  [
    param('jobId').isMongoId(),
    query('filter').optional().isIn(BOM_ITEM_FILTERS),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.getBOMJob
)

router.put('/items/:bomItemId/price',
  [
    param('bomItemId').isMongoId(),
    body('manualUnitCost').isNumeric(),
    body('saveToSMDT').optional().isBoolean(),
  ],
  validate,
  ctrl.priceBOMItem
)

router.post('/buildings/:buildingId/confirm',
  [param('buildingId').isMongoId()],
  validate,
  ctrl.confirmBuildingBOM
)

module.exports = router
