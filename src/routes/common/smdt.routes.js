const router = require('express').Router()
const { body, query, param } = require('express-validator')
const ctrl = require('../../controllers/common/smdt.controller')
const validate = require('../../middleware/validate')
const { SMDT_CATEGORIES, SMDT_COST_UNITS } = require('../../config/constants')

router.post('/upload',
  [
    body('fileUrl').notEmpty().trim(),
    body('fileName').optional().trim(),
    body('name').optional().trim(),
    body('effectiveDate').optional().isISO8601(),
    body('activate').optional().isBoolean(),
  ],
  validate,
  ctrl.uploadSMDT
)

router.get('/',
  [
    query('category').optional().isIn(SMDT_CATEGORIES),
    query('isFrameType').optional().isIn(['true', 'false']),
    query('isActive').optional().isIn(['true', 'false', 'all']),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.listSMDT
)

router.get('/:itemId',
  [param('itemId').isMongoId()],
  validate,
  ctrl.getSMDTItem
)

router.post('/',
  [
    body('category').notEmpty().isIn(SMDT_CATEGORIES),
    body('partName').notEmpty().trim(),
    body('partColor').optional().trim(),
    body('costUnit').isIn(SMDT_COST_UNITS),
    body('mbsCost').isNumeric(),
    body('currentMarketCost').optional().isNumeric(),
    body('laborCost').optional().isNumeric(),
    body('additionalCost').optional().isNumeric(),
    body('materialCost').optional().isNumeric(),
    body('description').optional().trim(),
  ],
  validate,
  ctrl.addSMDTItem
)

router.put('/:itemId',
  [
    param('itemId').isMongoId(),
    body('costUnit').optional().isIn(SMDT_COST_UNITS),
    body('mbsCost').optional().isNumeric(),
    body('currentMarketCost').optional().isNumeric(),
    body('laborCost').optional().isNumeric(),
    body('additionalCost').optional().isNumeric(),
    body('materialCost').optional().isNumeric(),
    body('extraMinCost').optional().isNumeric(),
    body('extraMaxCost').optional().isNumeric(),
    body('description').optional().trim(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.updateSMDTItem
)

router.delete('/:itemId',
  [param('itemId').isMongoId()],
  validate,
  ctrl.deactivateSMDTItem
)

module.exports = router
