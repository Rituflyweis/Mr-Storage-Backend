const Quotation = require('../models/Quotation')

// Sorts by the numeric quote value itself, not createdAt — createdAt reflects when the document
// was created, not when its quoteNumber was assigned, so an older quotation can get a number
// assigned after a newer one and "hide" the true max, producing duplicates.
const generateQuoteNumber = async () => {
  const rows = await Quotation.aggregate([
    { $match: { quoteNumber: { $regex: /^QUO-\d+$/ } } },
    { $project: { num: { $toInt: { $substrCP: ['$quoteNumber', 4, { $subtract: [{ $strLenCP: '$quoteNumber' }, 4] }] } } } },
    { $sort: { num: -1 } },
    { $limit: 1 },
  ])

  const next = (rows[0]?.num || 0) + 1
  return `QUO-${String(next).padStart(4, '0')}`
}

module.exports = generateQuoteNumber
