/** Mongo aggregation expressions for Tax filing records (legacy + Avalara sync). */

const taxCollectedExpr = {
  $sum: {
    $cond: [
      { $gt: [{ $ifNull: ['$taxCollected', 0] }, 0] },
      '$taxCollected',
      { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] },
    ],
  },
}

const taxableSalesExpr = {
  $sum: {
    $cond: [
      { $gt: [{ $ifNull: ['$taxableSales', 0] }, 0] },
      '$taxableSales',
      '$amount',
    ],
  },
}

const paidFiledExpr = {
  $sum: {
    $cond: [
      { $gt: [{ $ifNull: ['$paidFiled', 0] }, 0] },
      '$paidFiled',
      { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] },
    ],
  },
}

const payableExpr = {
  $sum: {
    $cond: [
      { $gte: [{ $ifNull: ['$payable', -1] }, 0] },
      '$payable',
      { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] },
    ],
  },
}

const taxDueExpr = {
  $sum: {
    $cond: [
      { $gt: [{ $ifNull: ['$taxDue', 0] }, 0] },
      '$taxDue',
      '$amount',
    ],
  },
}

const taxRollupFields = {
  taxCollected: taxCollectedExpr,
  taxableSales: taxableSalesExpr,
  paidFiled: paidFiledExpr,
  payable: payableExpr,
  nextDue: {
    $min: { $cond: [{ $eq: ['$status', 'pending'] }, '$dueDate', null] },
  },
  status: { $first: '$status' },
}

const stateWiseGroupStage = {
  $group: {
    _id: '$state',
    ...taxRollupFields,
  },
}

module.exports = {
  stateWiseGroupStage,
  taxRollupFields,
  taxCollectedExpr,
  taxableSalesExpr,
  paidFiledExpr,
  payableExpr,
  taxDueExpr,
}
