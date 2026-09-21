const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/admin/auditLog.controller')
const { USER_ROLES, AUDIT_TYPES } = require('../../config/constants')

router.get(
  '/',
  [
    query('panel').optional().isIn([...USER_ROLES, 'customer', 'public']),
    query('type').optional().isIn(AUDIT_TYPES),
    query('action').optional().isString(),
    query('actorId').optional().isMongoId(),
    query('performedBy').optional().isMongoId(),
    query('leadId').optional().isMongoId(),
    query('customerId').optional().isMongoId(),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('search').optional().isString(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
  ],
  validate,
  ctrl.listAuditLogs,
)

module.exports = router
