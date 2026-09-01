const OrderQuotation = require('../models/OrderQuotation')
const { allocateSequentialId, escapeRegExp } = require('./allocateSequentialId')

const generateOrderQuotationNumber = async () => {
  const year = new Date().getFullYear()
  const prefix = `INV/${year}/`
  return allocateSequentialId({
    model: OrderQuotation,
    field: 'quotationNumber',
    parsePattern: new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`),
    format: (n) => `${prefix}${String(n).padStart(4, '0')}`,
  })
}

module.exports = generateOrderQuotationNumber
