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

module.exports = { buildDateFilter }
