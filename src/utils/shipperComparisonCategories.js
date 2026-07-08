const COMPARISON_RESULT_CATEGORIES = ['matched', 'unmatched', 'extra', 'all']

const MATCHED_STATUSES = ['matched']

const EXTRA_STATUSES = ['extra_in_vendor_quote']

const UNMATCHED_STATUSES = [
  'missing_in_vendor_quote',
  'qty_mismatch',
  'length_mismatch',
  'weight_mismatch',
  'part_mismatch',
  'price_mismatch',
  'ambiguous_match',
]

const ALL_COMPARISON_STATUSES = [
  ...MATCHED_STATUSES,
  ...UNMATCHED_STATUSES,
  ...EXTRA_STATUSES,
]

const getStatusesForCategory = (category) => {
  switch (String(category || '').trim().toLowerCase()) {
    case 'matched':
      return MATCHED_STATUSES
    case 'extra':
      return EXTRA_STATUSES
    case 'unmatched':
      return UNMATCHED_STATUSES
    case 'all':
      return null
    default:
      return undefined
  }
}

const mapComparisonResultRow = (row) => ({
  resultId: row._id,
  status: row.status,
  severity: row.severity,
  expected: row.expected,
  received: row.received,
  difference: row.difference,
  matchMethod: row.matchMethod,
  matchConfidence: row.matchConfidence,
  reason: row.reason,
  createdAt: row.createdAt,
})

const buildComparisonStatsFromStatusCounts = (statusCounts = {}) => {
  const matched = statusCounts.matched || 0
  const extra = statusCounts.extra_in_vendor_quote || 0

  const unmatchedBreakdown = {}
  let unmatched = 0
  for (const status of UNMATCHED_STATUSES) {
    const count = statusCounts[status] || 0
    if (count > 0) unmatchedBreakdown[status] = count
    unmatched += count
  }

  const all = matched + unmatched + extra

  return {
    matched: { count: matched },
    unmatched: { count: unmatched },
    extra: { count: extra },
    all: { count: all },
    unmatchedBreakdown,
  }
}

const aggregateComparisonStats = async (QuoteComparisonResult, shipperRequestId) => {
  const grouped = await QuoteComparisonResult.aggregate([
    { $match: { shipperRequestId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])

  const statusCounts = {}
  for (const row of grouped) {
    if (row._id) statusCounts[row._id] = row.count
  }

  return buildComparisonStatsFromStatusCounts(statusCounts)
}

module.exports = {
  COMPARISON_RESULT_CATEGORIES,
  MATCHED_STATUSES,
  EXTRA_STATUSES,
  UNMATCHED_STATUSES,
  ALL_COMPARISON_STATUSES,
  getStatusesForCategory,
  mapComparisonResultRow,
  buildComparisonStatsFromStatusCounts,
  aggregateComparisonStats,
}
