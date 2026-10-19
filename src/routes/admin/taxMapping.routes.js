const router = require('express').Router()
const { body, param } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/admin/taxMapping.controller')

// GET /api/admin/tax-mappings
router.get('/', ctrl.listTaxMappings)

// PUT /api/admin/tax-mappings/:id
router.put(
  '/:id',
  [
    param('id').isMongoId(),
    body('approval_status').optional().isIn(['DRAFT', 'PENDING', 'APPROVED']),
    body('item_type').optional().isIn(['PRODUCT', 'SERVICE']),
    body('avalara_tax_code').optional({ nullable: true }).isString().trim(),
    body('keywords').optional().isArray(),
  ],
  validate,
  ctrl.updateTaxMapping
)

// GET /api/admin/tax-mappings/:id/audit
router.get('/:id/audit', [param('id').isMongoId()], validate, ctrl.getTaxMappingAudit)

module.exports = router
