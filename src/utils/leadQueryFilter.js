const Customer = require('../models/Customer')
const { buildDateFilter } = require('./dateRange')
const { LEAD_TEMPERATURES, resolveLeadTemperatureFromScore } = require('../config/constants')
const { buildActiveLeadMatch } = require('./activeLeadScope')

// buildDateFilter only understands explicit startDate/endDate — a quick-filter pill sending
// `period=today` (the convention already used on the Account Dashboard) was silently ignored
// here, so a "Today" quick filter on the Leads screen showed all-time results with no error.
// Falls through to plain buildDateFilter whenever explicit dates are present.
const buildLeadDateFilter = (query = {}, field = 'createdAt') => {
  if (query.startDate || query.endDate) return buildDateFilter(query, field)
  if (!query.period) return {}

  const now = new Date()
  if (query.period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    return buildDateFilter({ startDate: start.toISOString(), endDate: end.toISOString() }, field)
  }
  if (query.period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return buildDateFilter({ startDate: start.toISOString(), endDate: end.toISOString() }, field)
  }
  return {}
}

const buildAdminLeadFilter = async (query = {}) => {
  const {
    search,
    buildingType,
    quoteValueMin,
    quoteValueMax,
    assignedSales,
    lifecycleStatus,
    source,
    isQuoteReady,
    isHandedToSales,
    isTerminated,
  } = query
  const dateFilter = buildLeadDateFilter(query)

  const filter = { ...buildActiveLeadMatch(), ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (assignedSales) filter.assignedSales = assignedSales
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (source) filter.source = source
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (isHandedToSales !== undefined) filter.isHandedToSales = isHandedToSales === 'true'
  if (isTerminated !== undefined) filter.isTerminated = isTerminated === 'true'
  if (quoteValueMin || quoteValueMax) {
    filter.quoteValue = {}
    if (quoteValueMin) filter.quoteValue.$gte = Number(quoteValueMin)
    if (quoteValueMax) filter.quoteValue.$lte = Number(quoteValueMax)
  }
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [{ firstName: regex }, { email: regex }, { customerId: regex }],
    }).distinct('_id')
    filter.$or = [{ projectName: regex }, { customerId: { $in: matchingCustomerIds } }]
  }

  return filter
}

const buildSalesLeadFilter = async (query = {}, salesId) => {
  const { search, buildingType, lifecycleStatus, isQuoteReady } = query
  const dateFilter = buildLeadDateFilter(query)

  const filter = { assignedSales: salesId, ...buildActiveLeadMatch(), ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [{ firstName: regex }, { email: regex }, { customerId: regex }],
    }).distinct('_id')
    filter.$or = [
      { projectName: regex },
      { buildingType: regex },
      { location: regex },
      { customerId: { $in: matchingCustomerIds } },
    ]
  }

  return filter
}

/**
 * Leads by score list — filters on Lead.updatedAt, optional temperature + search.
 * Query `status` is accepted as an alias for `temperature` (hot | warm | cold).
 */
const buildLeadsByScoreFilter = async (query = {}, { assignedSales } = {}) => {
  const filter = { ...buildActiveLeadMatch(), ...buildLeadDateFilter(query, 'updatedAt') }
  if (assignedSales) filter.assignedSales = assignedSales

  const temperature = query.temperature || query.status
  if (temperature) {
    if (!LEAD_TEMPERATURES.includes(temperature)) {
      return { error: 'Invalid status. Use hot, warm, or cold' }
    }
    filter['leadScoring.temperature'] = temperature
  }

  if (query.search && query.search.trim()) {
    const regex = new RegExp(query.search.trim(), 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [{ firstName: regex }, { email: regex }, { customerId: regex }],
    }).distinct('_id')
    filter.$or = [
      { projectName: regex },
      { jobId: regex },
      { customerId: { $in: matchingCustomerIds } },
    ]
  }

  return { filter }
}

const buildAdminLeadsByScoreFilter = async (query = {}) => buildLeadsByScoreFilter(query)

const buildSalesLeadsByScoreFilter = async (query = {}, salesId) =>
  buildLeadsByScoreFilter(query, { assignedSales: salesId })

const mapLeadByScoreRow = (lead) => {
  const score = lead.leadScoring?.score ?? 0
  const temperature = lead.leadScoring?.temperature
    ?? resolveLeadTemperatureFromScore(score)

  const jobId = lead.jobId || ''
  return {
    leadId: lead._id,
    jobId,
    projectId: jobId,
    customerName: lead.customerId?.firstName || '',
    projectName: lead.projectName || '',
    location: lead.location || '',
    lifecycleStatus: lead.lifecycleStatus,
    lifecycleHistory: Array.isArray(lead.lifecycleHistory) ? lead.lifecycleHistory : [],
    status: temperature,
    score,
    quoteValue: lead.quoteValue ?? 0,
    temperature,
    isOnline: lead.isOnline === true,
    lastSeenAt: lead.lastSeenAt || null,
    updatedAt: lead.updatedAt,
  }
}

module.exports = {
  buildAdminLeadFilter,
  buildSalesLeadFilter,
  buildAdminLeadsByScoreFilter,
  buildSalesLeadsByScoreFilter,
  mapLeadByScoreRow,
}
