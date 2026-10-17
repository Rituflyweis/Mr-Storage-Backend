const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/mergedDrawings.controller')

const listQuery = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('projectId').optional().isMongoId(),
  query('leadId').optional().isMongoId(),
  query('source').optional().isIn(['plant', 'document']),
  query('status').optional().isString().trim(),
  query('documentType').optional().isString().trim(),
  query('category').optional().isString().trim(),
  query('buildingLabel').optional().isString().trim(),
  validate,
]

router.get('/', listQuery, ctrl.listProjectDrawingsAndDocuments)
router.get('/by-project', listQuery, ctrl.listProjectDrawingsGrouped)

module.exports = router
