/** Mongo aggregation expressions for Tax filing records (Avalara sync + Returns). */

const taxCollectedExpr = {
  $sum: { $ifNull: ['$taxCollected', 0] },
}

const taxableSalesExpr = {
  $sum: { $ifNull: ['$taxableSales', 0] },
}

const paidFiledExpr = {
  $sum: {
    $cond: [
      { $gt: [{ $ifNull: ['$paidFiled', 0] }, 0] },
      '$paidFiled',
      { $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$taxDue', '$amount'] }, 0] },
    ],
  },
}

const payableExpr = {
  $sum: {
    $cond: [
      { $gte: [{ $ifNull: ['$payable', -1] }, 0] },
      '$payable',
      {
        $max: [
          0,
          {
            $subtract: [
              { $ifNull: ['$taxDue', '$amount'] },
              { $ifNull: ['$paidFiled', 0] },
            ],
          },
        ],
      },
    ],
  },
}

const taxDueExpr = {
  $sum: { $ifNull: ['$taxDue', { $ifNull: ['$amount', 0] }] },
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

/** State overview: Avalara/sync filing rows only (not manual seed / per-project duplicates). */
const stateOverviewTaxMatch = (extra = {}) => ({
  leadId: null,
  source: { $in: ['sync', 'avalara'] },
  ...extra,
})

module.exports = {
  stateWiseGroupStage,
  taxRollupFields,
  taxCollectedExpr,
  taxableSalesExpr,
  paidFiledExpr,
  payableExpr,
  taxDueExpr,
  stateOverviewTaxMatch,
}
