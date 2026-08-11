const POOrder = require('../models/POOrder')
const Lead = require('../models/Lead')
const { isAdminPlantScope } = require('./plantAccessScope')

const getApprovedPoForLead = (leadId, req) => {
  const filter = { leadId, status: 'approved' }
  if (!isAdminPlantScope(req)) {
    filter.assignedTo = req.user._id
  }
  return POOrder.findOne(filter).lean()
}

/**
 * Ensures the caller can access this plant project.
 * Plant users: approved PO assigned to them.
 * Admin plant scope (req.plantAccessScope === 'admin'): any approved PO for the lead.
 * @returns {{ lead, poOrder }} or {{ error, code }}
 */
const assertPlantProjectAccess = async (leadId, req) => {
  const [poOrder, lead] = await Promise.all([
    getApprovedPoForLead(leadId, req),
    Lead.findById(leadId),
  ])

  if (!lead) return { error: 'Project not found', code: 404 }
  if (!poOrder) return { error: 'Access denied', code: 403 }

  return { lead, poOrder }
}

/** @deprecated Use assertPlantProjectAccess(leadId, req) */
const getApprovedAssignedPo = (leadId, plantUserId) =>
  POOrder.findOne({ leadId, assignedTo: plantUserId, status: 'approved' }).lean()

module.exports = {
  getApprovedAssignedPo,
  getApprovedPoForLead,
  assertPlantProjectAccess,
}
