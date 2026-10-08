const PRODUCTION_OVERVIEW_FILTERS = ['today', 'week', 'month']

const normalizeFilter = (raw) => {
  const key = String(raw || 'today')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (key === 'this_week' || key === 'thisweek') return 'week'
  if (key === 'this_month' || key === 'thismonth') return 'month'
  if (PRODUCTION_OVERVIEW_FILTERS.includes(key)) return key
  return null
}

const startOfCalendarDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Monday-based week (local timezone). */
const startOfWeekMonday = (d) => {
  const date = startOfCalendarDay(d)
  const day = date.getDay()
  const diffFromMonday = day === 0 ? 6 : day - 1
  date.setDate(date.getDate() - diffFromMonday)
  return date
}

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)

/** Inclusive calendar-day range [start, endExclusive) for production overview queries. */
const resolveProductionOverviewRange = (filterKey, now = new Date()) => {
  const endExclusive = new Date(startOfCalendarDay(now))
  endExclusive.setDate(endExclusive.getDate() + 1)

  let start
  if (filterKey === 'week') start = startOfWeekMonday(now)
  else if (filterKey === 'month') start = startOfMonth(now)
  else start = startOfCalendarDay(now)

  return { filter: filterKey, start, endExclusive }
}

module.exports = {
  PRODUCTION_OVERVIEW_FILTERS,
  normalizeFilter,
  resolveProductionOverviewRange,
  startOfCalendarDay,
}
