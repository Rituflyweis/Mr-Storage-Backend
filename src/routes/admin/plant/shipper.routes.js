const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../../controllers/plant/shipper.controller')
const validate = require('../../../middleware/validate')

router.get('/stats', ctrl.getShipperFilesStats)

router.get('/projects', ctrl.getShipperProjects)

router.get('/projects/:leadId/stats',
  [param('leadId').isMongoId()],
  validate,
  ctrl.getProjectShipperFilesStats
)

router.get('/projects/:leadId/requests',
  [param('leadId').isMongoId()],
  validate,
  ctrl.getProjectShipperRequests
)

router.get('/:requestId/document',
  [param('requestId').isMongoId()],
  validate,
  ctrl.getShipperRequestDocument
)

router.post('/compare-jobs/status',
  [body('jobIds').isArray({ min: 1 }), body('jobIds.*').isMongoId()],
  validate,
  ctrl.getComparisonJobsStatusBatch
)

router.get('/compare-jobs/:jobId/status',
  [param('jobId').isMongoId()],
  validate,
  ctrl.getComparisonJobStatus
)

router.post('/:requestId/compare',
  [param('requestId').isMongoId()],
  validate,
  ctrl.compareShipperRequest
)

router.post('/:requestId/approve',
  [param('requestId').isMongoId()],
  validate,
  ctrl.approveShipperRequest
)

router.post('/:requestId/request-resubmit',
  [
    param('requestId').isMongoId(),
    body('note').optional().trim(),
    body('includeComparisonExceptions').optional().isBoolean(),
  ],
  validate,
  ctrl.requestShipperResubmit
)

router.get('/:requestId/comparison-summary',
  [param('requestId').isMongoId()],
  validate,
  ctrl.getShipperComparisonSummary
)

router.get('/:requestId/comparison-results',
  [
    param('requestId').isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('category').optional().isIn(['matched', 'unmatched', 'extra', 'all']),
    query('status').optional().isString().trim(),
    query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  ],
  validate,
  ctrl.getShipperComparisonResults
)

router.post('/:requestId/bundle-plan/generate',
  [param('requestId').isMongoId()],
  validate,
  ctrl.generateBundlePlan
)

module.exports = router
