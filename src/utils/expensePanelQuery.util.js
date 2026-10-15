const { buildDateFilter } = require('./dateRange')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const pctChange = (current, previous) => {
  if (!previous || previous === 0) return current > 0 ? 100 : 0
  return round2(((current - previous) / Math.abs(previous)) * 100)
}

const panelBaseFilter = (costPanelType, query = {}) => {
  const dateFilter = buildDateFilter(query, 'date')
  const filter = { isActive: true, costPanelType, ...dateFilter }
  if (query.leadId || query.projectId) filter.leadId = query.leadId || query.projectId
  if (query.status) filter.status = query.status
  if (query.search?.trim()) {
    const re = new RegExp(query.search.trim(), 'i')
    filter.$or = [{ description: re }, { expenseId: re }, { buildingLabel: re }]
  }
  return filter
}

const monthWindows = () => {
  const now = new Date()
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  return { now, thisStart, lastStart, lastEnd }
}

const sumExpenses = (rows) => rows.reduce((s, e) => s + (e.amount || 0), 0)

module.exports = {
  round2,
  pctChange,
  panelBaseFilter,
  monthWindows,
  sumExpenses,
}
