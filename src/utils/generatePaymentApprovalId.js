const PaymentApproval = require('../models/PaymentApproval')
const { allocateSequentialId, escapeRegExp } = require('./allocateSequentialId')

const generatePaymentApprovalId = async () => {
  const year = new Date().getFullYear()
  const prefix = `PR-${year}-`
  return allocateSequentialId({
    model: PaymentApproval,
    field: 'paymentId',
    parsePattern: new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`),
    format: (n) => `${prefix}${String(n).padStart(5, '0')}`,
  })
}

module.exports = generatePaymentApprovalId
