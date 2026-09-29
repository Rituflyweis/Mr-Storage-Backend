const POOrder = require('../models/POOrder')
const Lead = require('../models/Lead')
const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')
const { isAdminPlantScope, isConstructionPlantScope } = require('./plantAccessScope')

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
 * Construction scope (req.plantAccessScope === 'construction'): lead in plant lifecycle stages.
 * @returns {{ lead, poOrder }} or {{ error, code }}
 */
const isConstructionStageLead = (lead) =>
  lead
  && lead.isTerminated !== true
  && PLANT_LIFECYCLE_STAGES.includes(lead.lifecycleStatus)

const assertPlantProjectAccess = async (leadId, req) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Project not found', code: 404 }

  if (isConstructionPlantScope(req)) {
    if (!isConstructionStageLead(lead)) {
      return { error: 'Access denied', code: 403 }
    }
    return { lead, poOrder: null }
  }

  const poOrder = await getApprovedPoForLead(leadId, req)
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
