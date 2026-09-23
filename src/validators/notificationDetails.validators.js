const { query } = require('express-validator')

const notificationDetailsQueryValidators = [
  query('page').optional({ checkFalsy: true }).isInt({ min: 1 }),
  query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 200 }),
  query('search').optional({ checkFalsy: true }).isString().trim(),
  query('leadId').optional({ checkFalsy: true }).isMongoId(),
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('deliveryId').optional({ checkFalsy: true }).isMongoId(),
  query('status').optional({ checkFalsy: true }).isString().trim(),
  query('deliveryStatus').optional({ checkFalsy: true }).isString().trim(),
  query('notificationStatus').optional({ checkFalsy: true }).isString().trim(),
  query('channel').optional({ checkFalsy: true }).isString().trim(),
  query('channelType').optional({ checkFalsy: true }).isString().trim(),
  query('recipientType').optional({ checkFalsy: true }).isString().trim(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
]

module.exports = { notificationDetailsQueryValidators }
