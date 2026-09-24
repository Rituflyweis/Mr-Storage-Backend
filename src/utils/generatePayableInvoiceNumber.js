const Invoice = require('../models/Invoice')

const generatePayableInvoiceNumber = async (invoiceType) => {
  const prefix = invoiceType === 'freight_carrier' ? 'FINV' : 'VINV'
  const year = new Date().getFullYear()
  const basePrefix = `${prefix}-${year}-`
  const last = await Invoice.findOne({
    invoiceType,
    invoiceNumber: { $regex: new RegExp(`^${basePrefix.replace(/-/g, '\\-')}`) },
  })
    .sort({ invoiceNumber: -1 })
    .select('invoiceNumber')
    .lean()

  let seq = 1000
  if (last?.invoiceNumber) {
    const part = String(last.invoiceNumber).split('-').pop()
    const n = parseInt(part, 10)
    if (Number.isFinite(n)) seq = n + 1
  }

  return `${basePrefix}${seq}`
}

module.exports = generatePayableInvoiceNumber
