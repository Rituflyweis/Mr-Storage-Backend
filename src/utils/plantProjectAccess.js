const POOrder = require('../models/POOrder')
const Lead = require('../models/Lead')

const getApprovedAssignedPo = (leadId, plantUserId) =>
  POOrder.findOne({ leadId, assignedTo: plantUserId, status: 'approved' }).lean()

/**
 * Ensures the plant user has an approved PO assigned for this lead.
 * @returns {{ lead, poOrder }} or {{ error, code }}
 */
const assertPlantProjectAccess = async (leadId, plantUserId) => {
  const [poOrder, lead] = await Promise.all([
    getApprovedAssignedPo(leadId, plantUserId),
    Lead.findById(leadId),
  ])

  if (!lead) return { error: 'Project not found', code: 404 }
  if (!poOrder) return { error: 'Access denied', code: 403 }

  return { lead, poOrder }
}

module.exports = {
  getApprovedAssignedPo,
  assertPlantProjectAccess,
}
