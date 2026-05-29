const router = require('express').Router()
const { query } = require('express-validator')
const ctrl = require('../../controllers/plant/project.controller')
const validate = require('../../middleware/validate')

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

module.exports = router
