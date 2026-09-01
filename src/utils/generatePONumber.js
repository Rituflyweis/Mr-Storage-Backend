const Invoice = require('../models/Invoice')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generatePONumber = async () =>
  allocatePrefixedCode({
    model: Invoice,
    field: 'poNumber',
    prefix: 'PO',
    pad: 4,
    filter: { poNumber: { $regex: /^PO-\d+$/i } },
  })

module.exports = generatePONumber
