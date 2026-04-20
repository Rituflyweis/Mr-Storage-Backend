const Invoice = require('../models/Invoice')

const generateInvoiceNumber = async () => {
  const last = await Invoice.findOne({}, { invoiceNumber: 1 })
    .sort({ createdAt: -1 })
    .lean()

  if (!last || !last.invoiceNumber) return 'INV-0001'

  const num = parseInt(last.invoiceNumber.split('-')[1], 10)
  const next = num + 1
  return `INV-${String(next).padStart(4, '0')}`
}

module.exports = generateInvoiceNumber
