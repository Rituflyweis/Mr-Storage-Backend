const { body } = require('express-validator')

const optionalNumeric = (field) =>
  body(field)
    .optional({ values: 'null' })
    .customSanitizer((v) => (v === '' ? null : v))
    .custom((v) => v === null || v === undefined || !Number.isNaN(Number(v)))

const optionalPaymentScheduleStageId = () =>
  body('paymentScheduleStageId')
    .optional({ values: 'null' })
    .customSanitizer((v) => (v === '' ? null : v))
    .custom((v) => {
      if (v === null || v === undefined) return true
      return /^[a-f\d]{24}$/i.test(String(v))
    })

const optionalAddressObject = (field) => body(field).optional().isObject()
const optionalBankObject = () => body('bankDetails').optional().isObject()

const invoiceCreateValidators = [
  body('totalAmount').notEmpty().custom((v) => !Number.isNaN(Number(v))),
  optionalAddressObject('billingAddress'),
  optionalAddressObject('recipientAddress'),
  optionalBankObject(),
  body('date').optional().isISO8601(),
  optionalNumeric('daysToPay'),
  optionalNumeric('tax'),
  optionalNumeric('discount'),
  optionalPaymentScheduleStageId(),
  body('lineItems').optional().isArray(),
  body('lineItems.*.markupType').optional().isIn(['percentage', 'amount']),
  body('lineItems.*.taxType').optional().isIn(['percentage', 'amount']),
]

const invoiceBodyValidators = [
  optionalAddressObject('billingAddress'),
  optionalAddressObject('recipientAddress'),
  optionalBankObject(),
  optionalNumeric('totalAmount'),
  body('date').optional().isISO8601(),
  optionalNumeric('daysToPay'),
  optionalNumeric('tax'),
  optionalNumeric('discount'),
  optionalPaymentScheduleStageId(),
  body('lineItems').optional().isArray(),
  body('lineItems.*.markupType').optional().isIn(['percentage', 'amount']),
  body('lineItems.*.taxType').optional().isIn(['percentage', 'amount']),
]

module.exports = {
  invoiceBodyValidators,
  invoiceCreateValidators,
  optionalNumeric,
  optionalPaymentScheduleStageId,
}
