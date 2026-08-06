/** Mongo sort: newest vendor quote / request activity first (project list views). */
const SHIPPER_REQUEST_LATEST_FIRST_SORT = {
  submittedAt: -1,
  updatedAt: -1,
  sentAt: -1,
  createdAt: -1,
}

const getShipperRequestActivityTime = (row = {}) => {
  const t = row.submittedAt || row.updatedAt || row.sentAt || row.createdAt
  return t ? new Date(t).getTime() : 0
}

const hasShipperQuoteValue = (row = {}) => {
  const n = Number(row.quoteValue)
  return row.quoteValue != null && Number.isFinite(n)
}

/** Lowest vendor bid first; rows without a quote amount last. */
const sortShipperRequestsByLowestBid = (requests = []) =>
  [...requests].sort((a, b) => {
    const aHas = hasShipperQuoteValue(a)
    const bHas = hasShipperQuoteValue(b)

    if (aHas && bHas) {
      const diff = Number(a.quoteValue) - Number(b.quoteValue)
      if (diff !== 0) return diff
    } else if (aHas !== bHas) {
      return aHas ? -1 : 1
    }

    return getShipperRequestActivityTime(b) - getShipperRequestActivityTime(a)
  })

module.exports = {
  SHIPPER_REQUEST_LATEST_FIRST_SORT,
  getShipperRequestActivityTime,
  sortShipperRequestsByLowestBid,
}
