const Lead = require('../models/Lead')
const Delivery = require('../models/Delivery')
const Building = require('../models/Building')
const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')
const { buildBusinessUnitFilter } = require('./businessUnit')

const CONSTRUCTION_STAGES = [...PLANT_LIFECYCLE_STAGES]

const baseConstructionMongoFilter = () => ({
  isTerminated: { $ne: true },
  isArchived: { $ne: true },
  lifecycleStatus: { $in: CONSTRUCTION_STAGES },
})

/** Dashboard + KPI scope (project, building, lifecycle status, business unit). */
const buildDashboardScopeFilter = async (parsed = {}) => {
  const filter = baseConstructionMongoFilter()
  if (parsed.projectId) filter._id = parsed.projectId
  if (parsed.status) filter.lifecycleStatus = parsed.status
  if (parsed.businessUnit !== undefined) filter.businessUnit = parsed.businessUnit

  if (parsed.buildingId) {
    const building = await Building.findById(parsed.buildingId).select('leadId').lean()
    if (!building?.leadId) return null
    const buildingLeadId = String(building.leadId)
    if (parsed.projectId && String(parsed.projectId) !== buildingLeadId) return null
    filter._id = building.leadId
  }

  return filter
}

const getConstructionLeadIds = async (parsed = {}) => {
  const filter = await buildDashboardScopeFilter(parsed)
  if (!filter) return []
  const leads = await Lead.find(filter).select('_id').lean()
  return leads.map((l) => l._id)
}

/**
 * Projects list filter — same construction scope as dashboard, plus list-only filters.
 * `scopeOnly: true` drops search / hasDelivery / priority so KPIs match the dashboard.
 */
const buildConstructionProjectsFilter = async (query = {}, { scopeOnly = false } = {}) => {
  const filter = baseConstructionMongoFilter()
  const { status, priority, search, hasDelivery } = query

  const bu = buildBusinessUnitFilter(query.businessUnit)
  if (bu) Object.assign(filter, bu)

  if (status && CONSTRUCTION_STAGES.includes(status)) {
    filter.lifecycleStatus = status
  }

  if (!scopeOnly) {
    if (priority) filter.priority = priority
    if (search?.trim()) {
      const regex = { $regex: search.trim(), $options: 'i' }
      filter.$or = [{ projectName: regex }, { jobId: regex }]
    }
    if (String(hasDelivery).toLowerCase() === 'true' || hasDelivery === '1') {
      const leadIdsWithDelivery = await Delivery.distinct('leadId', {
        status: { $nin: ['draft', 'cancelled'] },
      })
      filter._id = { $in: leadIdsWithDelivery }
    }
  }

  return filter
}

const listOnlyFilterKeys = (query = {}) => {
  const applied = []
  if (query.priority) applied.push('priority')
  if (query.search?.trim()) applied.push('search')
  if (String(query.hasDelivery).toLowerCase() === 'true' || query.hasDelivery === '1') {
    applied.push('hasDelivery')
  }
  return applied
}

module.exports = {
  CONSTRUCTION_STAGES,
  baseConstructionMongoFilter,
  buildDashboardScopeFilter,
  getConstructionLeadIds,
  buildConstructionProjectsFilter,
  listOnlyFilterKeys,
}
