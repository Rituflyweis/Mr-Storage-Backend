const router = require('express').Router()
const { body, param, query } = require('express-validator')
const ctrl = require('../../controllers/common/customerDirectChat.controller')
const validate = require('../../middleware/validate')

router.get(
  '/conversations',
  [
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.listStaffDirectConversations
)

router.get(
  '/:customerId/messages',
  [
    param('customerId').isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.getStaffDirectMessages
)

router.post(
  '/:customerId/messages',
  [param('customerId').isMongoId(), body('content').notEmpty().trim()],
  validate,
  ctrl.sendStaffDirectMessage
)

module.exports = router
