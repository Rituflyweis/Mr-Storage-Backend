const Invoice = require('../models/Invoice')

/**
 * Next invoice number (INV-0001, INV-0002, …).
 * Uses the highest existing numeric suffix — not createdAt — so gaps,
 * backfills, or out-of-order creates do not collide with unique invoiceNumber.
 */
const generateInvoiceNumber = async () => {
  const [last] = await Invoice.aggregate([
    { $match: { invoiceNumber: { $regex: /^INV-\d+$/ } } },
    {
      $project: {
        n: {
          $toInt: {
            $arrayElemAt: [{ $split: ['$invoiceNumber', '-'] }, 1],
          },
        },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ])

  const next = (last?.n || 0) + 1
  return `INV-${String(next).padStart(4, '0')}`
}

module.exports = generateInvoiceNumber
