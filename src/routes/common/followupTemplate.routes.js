const router = require('express').Router()
const { body, param, query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/followupTemplate.controller')

router.get(
  '/',
  [
    query('search').optional().isString(),
    query('isActive').optional().isBoolean(),
    query('includeDeleted').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.listTemplates
)

router.get('/:templateId', [param('templateId').isMongoId()], validate, ctrl.getTemplate)

router.post(
  '/',
  [
    body('title').notEmpty().isString().trim(),
    body('message').notEmpty().isString().trim(),
    body('category').optional().isString().trim(),
    body('sortOrder').optional().isNumeric(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.createTemplate
)

router.put(
  '/:templateId',
  [
    param('templateId').isMongoId(),
    body('title').optional().isString().trim(),
    body('message').optional().isString().trim(),
    body('category').optional().isString().trim(),
    body('sortOrder').optional().isNumeric(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.updateTemplate
)

router.delete('/:templateId', [param('templateId').isMongoId()], validate, ctrl.deleteTemplate)

module.exports = router
