const router = require('express').Router({ mergeParams: true })
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/structuralDrawing.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getProjectStructuralDrawing)
router.post(
  '/',
  [
    body('name').notEmpty().trim(),
    body('fileUrl').notEmpty().trim(),
    body('fileType').optional().isString().trim(),
    body('fileSize').optional().isNumeric(),
    body('notes').optional().isString().trim(),
    body('buildingLabel').optional().isString().trim(),
  ],
  validate,
  ctrl.uploadProjectStructuralDrawing
)

module.exports = router
