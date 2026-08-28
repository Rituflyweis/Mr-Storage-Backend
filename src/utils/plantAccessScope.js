const POOrder = require('../models/POOrder')
const Lead = require('../models/Lead')
const { buildDateFilter } = require('./dateRange')

const isAdminPlantScope = (req) => req?.plantAccessScope === 'admin'

const getScopedLeadIds = async (req, query = req?.query || {}) => {
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
  getScopedLeadIds,
}
