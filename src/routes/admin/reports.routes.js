const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/admin/reports.controller')

router.get(
  '/analytics',
  [
    query('lifecycleStatus').optional().isString(),
    query('timeframe').optional().isIn(['monthly']),
    query('months').optional().isInt({ min: 1, max: 24 }),
  ],
  validate,
  ctrl.getSalesAnalytics
)

module.exports = router
