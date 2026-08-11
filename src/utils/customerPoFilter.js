const Lead = require('../models/Lead')

/** Leads/projects visible in customer-panel project lists */
const PO_PROJECT_MATCH = { isRaisedToPO: true, isDeleted: { $ne: true } }

/**
 * Customer IDs that have at least one project raised to PO.
 * @param {object} [leadFilter] - extra Lead query constraints (e.g. assignedSales for sales)
 */
const getCustomerIdsWithRaisedPO = async (leadFilter = {}) => {
  return Lead.find({ ...PO_PROJECT_MATCH, ...leadFilter }).distinct('customerId')
}

const getSalesCustomerIdsWithRaisedPO = async (salesId) => {
  return getCustomerIdsWithRaisedPO({ assignedSales: salesId })
}

module.exports = {
  PO_PROJECT_MATCH,
  getCustomerIdsWithRaisedPO,
  getSalesCustomerIdsWithRaisedPO,
}
