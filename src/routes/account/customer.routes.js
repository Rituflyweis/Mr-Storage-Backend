const router = require('express').Router()
const { query, param } = require('express-validator')
const ctrl = require('../../controllers/account/customer.controller')
const customerDocCtrl = require('../../controllers/common/customerDocument.controller')
const validate = require('../../middleware/validate')

router.get(
  '/stats',
  [
    query('period').optional().isIn(['today', 'week', 'month']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getStats
)

router.get(
  '/',
  [
    query('period').optional().isIn(['today', 'week', 'month']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('search').optional().isString().trim(),
    query('source').optional().isString().trim(),
    query('imported').optional().isIn(['true', 'false', '1', '0', 'yes', 'no']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.listCustomers
)

router.get('/:customerId/documents', customerDocCtrl.listCustomerDocuments)

router.get(
  '/:customerId',
  [
    param('customerId').notEmpty().trim(),
    query('period').optional().isIn(['today', 'week', 'month']),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('search').optional().isString().trim(),
  ],
  validate,
  ctrl.getCustomerDetail
)

module.exports = router
