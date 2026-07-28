const Quotation = require('../models/Quotation')

const generateQuoteNumber = async () => {
  const last = await Quotation.findOne({}, { quoteNumber: 1 })
    .sort({ createdAt: -1 })
    .lean()

  if (!last?.quoteNumber) return 'QUO-0001'

  const next = parseInt(last.quoteNumber.split('-')[1], 10) + 1
  return `QUO-${String(next).padStart(4, '0')}`
}

module.exports = generateQuoteNumber
