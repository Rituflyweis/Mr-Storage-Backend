const Quotation = require('../models/Quotation')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateQuoteNumber = async () =>
  allocatePrefixedCode({
    model: Quotation,
    field: 'quoteNumber',
    prefix: 'QUO',
    pad: 4,
    filter: { quoteNumber: { $regex: /^QUO-\d+$/i } },
  })

module.exports = generateQuoteNumber
