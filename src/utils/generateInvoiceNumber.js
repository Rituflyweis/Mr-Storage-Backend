const Invoice = require('../models/Invoice')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateInvoiceNumber = async () =>
  allocatePrefixedCode({
    model: Invoice,
    field: 'invoiceNumber',
    prefix: 'INV',
    pad: 4,
    filter: { invoiceNumber: { $regex: /^INV-\d+$/i } },
  })

module.exports = generateInvoiceNumber
