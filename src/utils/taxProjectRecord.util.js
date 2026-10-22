const Tax = require('../models/Tax')

const resolveLeadJurisdictionState = (lead) => {
  if (!lead) return ''
  const fromInstall = lead.installAddress?.state
  if (fromInstall) return String(fromInstall).trim()
  if (lead.state) return String(lead.state).trim()
  return ''
}

const stateMatchQuery = (state) => {
  const s = String(state || '').trim()
  if (!s) return null
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped}$`, 'i')
}

/**
 * Primary pending Tax row for project-wise "View Details" / Pay Tax.
 * Prefers invoice sync rollup for the project, then pending tax in the lead's jurisdiction state.
 */
const findPrimaryPendingTaxForProject = async (leadId, lead) => {
  if (!leadId) return null

  const syncRolling = await Tax.findOne({
    leadId,
    source: 'sync',
    periodKey: 'rolling',
    status: 'pending',
  })
    .sort({ dueDate: 1 })
    .select('_id state dueDate payable taxDue amount')
    .lean()
  if (syncRolling) return syncRolling

  const jurisdiction = resolveLeadJurisdictionState(lead)
  const rx = stateMatchQuery(jurisdiction)
  if (rx) {
    const byJurisdiction = await Tax.findOne({
      leadId,
      status: 'pending',
      state: rx,
    })
      .sort({ dueDate: 1 })
      .select('_id state dueDate payable taxDue amount')
      .lean()
    if (byJurisdiction) return byJurisdiction
  }

  return Tax.findOne({ leadId, status: 'pending' })
    .sort({ dueDate: 1 })
    .select('_id state dueDate payable taxDue amount')
    .lean()
}

module.exports = {
  resolveLeadJurisdictionState,
  findPrimaryPendingTaxForProject,
}
