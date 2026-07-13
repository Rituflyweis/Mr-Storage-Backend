const POOrder = require('../models/POOrder')
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

  return POOrder.distinct('leadId', filter)
}

module.exports = {
  isAdminPlantScope,
  getScopedLeadIds,
}
