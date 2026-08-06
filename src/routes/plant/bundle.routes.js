const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/plant/bundle.controller')
const validate = require('../../middleware/validate')

const BUNDLE_TYPES = ['panels', 'trim', 'framing', 'fasteners', 'accessories', 'mixed', 'custom']
const STACK_LEVELS = ['bottom', 'middle', 'top', 'any']

router.get('/:bundleId',
  [param('bundleId').isMongoId()],
  validate,
  ctrl.getBundle
)

router.put('/:bundleId',
  [
    param('bundleId').isMongoId(),
    body('bundleType').optional().isIn(BUNDLE_TYPES),
    body('title').optional().isString().trim(),
    body('loadSequence')
      .optional({ values: 'null' })
      .custom((value) => {
        if (value == null) return true
        const n = Number(value)
        if (!Number.isInteger(n) || n < 1) {
          throw new Error('loadSequence must be a positive integer')
        }
        return true
      }),
    body('handlingInstruction').optional().isString().trim(),
    body('notes').optional().isString().trim(),
    body('items').optional().isArray(),
    body('items.*.vendorQuoteLineId').optional().isMongoId(),
    body('items.*.qty').optional().isFloat({ min: 0.0001 }),
    body('items.*.partCode').optional().isString().trim(),
    body('items.*.description').optional().isString().trim(),
    body('items.*.category').optional().isString().trim(),
    body('items.*.color').optional().isString().trim(),
    body('items.*.lengthFeet').optional({ nullable: true }).isFloat({ min: 0 }),
    body('items.*.widthFeet').optional({ nullable: true }).isFloat({ min: 0 }),
    body('items.*.heightFeet').optional({ nullable: true }).isFloat({ min: 0 }),
    body('items.*.weight').optional({ nullable: true }).isFloat({ min: 0 }),
    body('items.*.markIds').optional().isArray(),
    body('stacking').optional().isObject(),
    body('stacking.stackLevel').optional().isIn(STACK_LEVELS),
    body('stacking.canStackOnTop').optional().isBoolean(),
    body('stacking.canHaveItemsStackedOnIt').optional().isBoolean(),
    body('stacking.isFragile').optional().isBoolean(),
    body('stacking.mustStayFlat').optional().isBoolean(),
    body('stacking.keepDry').optional().isBoolean(),
    body('stacking.requiresEdgeProtection').optional().isBoolean(),
    body('stacking.loadingPriority').optional().isInt({ min: 0 }),
    body('stacking.unloadingPriority').optional().isInt({ min: 0 }),
    body('stacking.stackingNotes').optional().isString().trim(),
  ],
  validate,
  ctrl.updateBundle
)

router.delete('/:bundleId',
  [param('bundleId').isMongoId()],
  validate,
  ctrl.deleteBundle
)

module.exports = router
