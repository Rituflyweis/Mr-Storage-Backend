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

const invoiceCreateValidators = [
  body('totalAmount').notEmpty().custom((v) => !Number.isNaN(Number(v))),
  body('date').optional().isISO8601(),
  optionalNumeric('daysToPay'),
  optionalNumeric('tax'),
  optionalPaymentScheduleStageId(),
]

const invoiceBodyValidators = [
  optionalNumeric('totalAmount'),
  body('date').optional().isISO8601(),
  optionalNumeric('daysToPay'),
  optionalNumeric('tax'),
  optionalPaymentScheduleStageId(),
]

module.exports = {
  invoiceBodyValidators,
  invoiceCreateValidators,
  optionalNumeric,
  optionalPaymentScheduleStageId,
}
