const Customer = require('../models/Customer')
const { buildDateFilter } = require('./dateRange')
const { LEAD_TEMPERATURES, resolveLeadTemperatureFromScore } = require('../config/constants')

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
  const dateFilter = buildDateFilter(query)

  const filter = { ...dateFilter }
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
  const dateFilter = buildDateFilter(query)

  const filter = { assignedSales: salesId, ...dateFilter }
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
  const filter = buildDateFilter(query, 'updatedAt')
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

  return {
    leadId: lead._id,
    projectId: lead.jobId || '',
    customerName: lead.customerId?.firstName || '',
    projectName: lead.projectName || '',
    location: lead.location || '',
    lifecycleStatus: lead.lifecycleStatus,
    lifecycleHistory: Array.isArray(lead.lifecycleHistory) ? lead.lifecycleHistory : [],
    status: temperature,
    score,
    quoteValue: lead.quoteValue ?? 0,
    temperature,
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
