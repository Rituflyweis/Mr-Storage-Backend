/**
 * Builds a mongoose date range filter from req.query startDate / endDate.
 * Field defaults to 'createdAt'. Returns empty object if neither provided.
 *
 * Usage:
 *   const filter = buildDateFilter(req.query, 'followUpDate')
 *   Lead.find({ ...otherFilters, ...filter })
 */
const buildDateFilter = (query = {}, field = 'createdAt') => {
  const { startDate, endDate } = query
  if (!startDate && !endDate) return {}

  const filter = {}
  const range = {}

  if (startDate) {
    const d = new Date(startDate)
    if (!isNaN(d)) range.$gte = d
  }
  if (endDate) {
    const d = new Date(endDate)
    if (!isNaN(d)) {
      // Include the full end day
      d.setHours(23, 59, 59, 999)
      range.$lte = d
    }
  }

  if (Object.keys(range).length) filter[field] = range
  return filter
}

/**
 * Account dashboard quick filters: period=today|week|month (ignored when startDate/endDate set).
 */
const buildPeriodDateFilter = (query = {}, field = 'createdAt') => {
  if (query.startDate || query.endDate) return buildDateFilter(query, field)
  if (!query.period) return {}

  const now = new Date()
  let start
  let end

  if (query.period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  } else if (query.period === 'week') {
    start = new Date(now)
    const day = start.getDay()
    const mondayOffset = day === 0 ? 6 : day - 1
    start.setDate(start.getDate() - mondayOffset)
    start.setHours(0, 0, 0, 0)
    end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
  } else if (query.period === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  } else {
    return {}
  }

  return buildDateFilter(
    { startDate: start.toISOString(), endDate: end.toISOString() },
    field
  )
}

module.exports = { buildDateFilter, buildPeriodDateFilter }
