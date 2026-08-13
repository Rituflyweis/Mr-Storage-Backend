const Invoice = require('../models/Invoice')

/**
 * Auto-generate next PO number (PO-0001, PO-0002 ...).
 * Called when creating the FIRST invoice on a lead.
 * Subsequent invoices on the same lead carry the first invoice's poNumber forward.
 *
 * Sorts by the numeric PO value itself, not createdAt — createdAt reflects when the invoice
 * document was created, not when its poNumber was assigned, so an older invoice can get a
 * PO number assigned after a newer one and "hide" the true max, producing duplicates.
 */
const generatePONumber = async () => {
  const rows = await Invoice.aggregate([
    { $match: { poNumber: { $regex: /^PO-\d+$/ } } },
    { $project: { num: { $toInt: { $substrCP: ['$poNumber', 3, { $subtract: [{ $strLenCP: '$poNumber' }, 3] }] } } } },
    { $sort: { num: -1 } },
    { $limit: 1 },
  ])

  const next = (rows[0]?.num || 0) + 1
  return `PO-${String(next).padStart(4, '0')}`
}

module.exports = generatePONumber
