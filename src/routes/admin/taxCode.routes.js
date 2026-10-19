const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/admin/taxMapping.controller')

// GET /api/admin/tax-codes?search=
router.get(
  '/',
  [
    query('search').optional().trim(),
    query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.searchTaxCodes
)

module.exports = router
