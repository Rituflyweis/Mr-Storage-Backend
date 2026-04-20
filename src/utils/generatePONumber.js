const Invoice = require('../models/Invoice')

/**
 * Auto-generate next PO number (PO-0001, PO-0002 ...).
 * Called when creating the FIRST invoice on a lead.
 * Subsequent invoices on the same lead carry the first invoice's poNumber forward.
 */
const generatePONumber = async () => {
  // Find the highest existing PO number across all invoices
  const last = await Invoice.findOne(
    { poNumber: { $regex: /^PO-\d+$/ } },
    { poNumber: 1 }
  )
    .sort({ createdAt: -1 })
    .lean()

  if (!last || !last.poNumber) return 'PO-0001'

  const num = parseInt(last.poNumber.split('-')[1], 10)
  const next = num + 1
  return `PO-${String(next).padStart(4, '0')}`
}

module.exports = generatePONumber
