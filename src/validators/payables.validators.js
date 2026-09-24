const { body, param, query } = require('express-validator')
const { INVOICE_CATEGORIES, PAYABLE_WORKFLOW_STATUSES } = require('../config/constants')

const mongoId = param('invoiceId').isMongoId()

const manualPayableBody = [
  body('leadId').isMongoId(),
  body('totalAmount').notEmpty().custom((v) => !Number.isNaN(Number(v))),
  body('category').optional({ checkFalsy: true }).isIn(INVOICE_CATEGORIES),
  body('description').optional({ checkFalsy: true }).isString().trim(),
  body('date').optional({ checkFalsy: true }).isISO8601(),
  body('daysToPay').optional({ checkFalsy: true }).isInt({ min: 1, max: 365 }),
  body('documentUrl').optional({ checkFalsy: true }).isString().trim(),
  body('documentFileName').optional({ checkFalsy: true }).isString().trim(),
  body('payeeName').optional({ checkFalsy: true }).isString().trim(),
]

const createVendorPayableValidators = [
  ...manualPayableBody,
  body('vendorId').isMongoId(),
]

const createFreightPayableValidators = [
  ...manualPayableBody,
  body('carrierId').isMongoId(),
]

const commentValidators = [
  mongoId,
  body('text').optional({ checkFalsy: true }).isString().trim(),
  body('comment').optional({ checkFalsy: true }).isString().trim(),
]

const rejectValidators = [
  mongoId,
  body('reason').optional({ checkFalsy: true }).isString().trim(),
  body('note').optional({ checkFalsy: true }).isString().trim(),
]

const accountListQuery = [
  query('invoiceType').optional({ checkFalsy: true }).isIn(['vendor', 'freight_carrier']),
  query('payableStatus').optional({ checkFalsy: true }).isIn(PAYABLE_WORKFLOW_STATUSES),
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('page').optional({ checkFalsy: true }).isInt({ min: 1 }),
  query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 100 }),
  query('search').optional({ checkFalsy: true }).isString().trim(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
]

const publicSubmitValidators = [
  param('token').notEmpty().isString(),
  body('documentUrl').notEmpty().trim(),
  body('documentFileName').optional({ checkFalsy: true }).isString().trim(),
  body('totalAmount').notEmpty().custom((v) => !Number.isNaN(Number(v))),
  body('description').optional({ checkFalsy: true }).isString().trim(),
  body('vendorInvoiceNumber').optional({ checkFalsy: true }).isString().trim(),
  body('daysToPay').optional({ checkFalsy: true }).isInt({ min: 1, max: 365 }),
]

const plantPayablesListQuery = [
  query('status').optional({ checkFalsy: true }).isString().trim(),
  query('payableStatus').optional({ checkFalsy: true }).isIn(PAYABLE_WORKFLOW_STATUSES),
  query('projectId').optional({ checkFalsy: true }).isMongoId(),
  query('page').optional({ checkFalsy: true }).isInt({ min: 1 }),
  query('limit').optional({ checkFalsy: true }).isInt({ min: 1, max: 100 }),
  query('search').optional({ checkFalsy: true }).isString().trim(),
  query('startDate').optional({ checkFalsy: true }).isISO8601(),
  query('endDate').optional({ checkFalsy: true }).isISO8601(),
]

module.exports = {
  createVendorPayableValidators,
  createFreightPayableValidators,
  commentValidators,
  rejectValidators,
  accountListQuery,
  plantPayablesListQuery,
  publicSubmitValidators,
  mongoId,
}
