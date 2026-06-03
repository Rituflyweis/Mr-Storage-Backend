const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/plant/shipper.controller')
const validate = require('../../middleware/validate')

router.get('/projects', ctrl.getShipperProjects)

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

module.exports = router
