const POOrder = require('../models/POOrder')
const Lead = require('../models/Lead')
const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')
const { buildDateFilter } = require('./dateRange')

const isAdminPlantScope = (req) => req?.plantAccessScope === 'admin'
const isConstructionPlantScope = (req) => req?.plantAccessScope === 'construction'

const getConstructionScopedLeadIds = async (query = {}) => {
  const filter = {
    isTerminated: { $ne: true },
    lifecycleStatus: { $in: PLANT_LIFECYCLE_STAGES },
    ...buildDateFilter(query, 'createdAt'),
  }
  return Lead.distinct('_id', filter)
}

const getScopedLeadIds = async (req, query = req?.query || {}) => {
  if (isConstructionPlantScope(req)) {
    return getConstructionScopedLeadIds(query)
  }

  const filter = {
    status: 'approved',
    ...buildDateFilter(query, 'createdAt'),
  }

  if (!isAdminPlantScope(req)) {
    filter.assignedTo = req.user._id
  }

  const leadIds = await POOrder.distinct('leadId', filter)
  if (!leadIds.length) return []

  return Lead.distinct('_id', { _id: { $in: leadIds } })
}

module.exports = {
  isAdminPlantScope,
  isConstructionPlantScope,
  getConstructionScopedLeadIds,
  getScopedLeadIds,
}
