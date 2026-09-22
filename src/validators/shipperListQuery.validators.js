const { query } = require('express-validator')
const {
  SHIPPER_REQUEST_STATUSES,
} = require('../config/constants')
const SHIPPER_COMPARISON_STATUSES = ['idle', 'processing', 'completed', 'failed']

const shipperProjectListQueryValidators = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('search').optional().trim(),
  query('fileStatus').optional().isIn(['none', 'partial', 'all']),
  query('fileReceivedStatus').optional().isIn(['none', 'partial', 'all']),
  query('buildingType').optional().trim(),
  query('status').optional().isIn(SHIPPER_REQUEST_STATUSES),
  query('comparisonStatus').optional().isIn(SHIPPER_COMPARISON_STATUSES),
  query('vendorId').optional().isMongoId(),
  query('hasSubmittedFile').optional().isIn(['true', 'false']),
]

const shipperRequestListQueryValidators = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('search').optional().trim(),
  query('status').optional().isIn(SHIPPER_REQUEST_STATUSES),
  query('comparisonStatus').optional().isIn(SHIPPER_COMPARISON_STATUSES),
  query('vendorId').optional().isMongoId(),
  query('hasSubmittedFile').optional().isIn(['true', 'false']),
]

module.exports = {
  shipperProjectListQueryValidators,
  shipperRequestListQueryValidators,
}
