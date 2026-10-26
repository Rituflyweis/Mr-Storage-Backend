const mongoose = require('mongoose')
const Lead = require('../models/Lead')
const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')

/** Lifecycle stages where revenue / profit / payments are recognized (PO + plant). */
const FINANCIAL_TRACKING_LIFECYCLE_STAGES = [
  'converted_to_po',
  'sent_to_admin',
  ...PLANT_LIFECYCLE_STAGES,
]

const FINANCIAL_LEAD_EXclusions = {
  isTerminated: { $ne: true },
  isArchived: { $ne: true },
  isDeleted: { $ne: true },
}

/**
 * Mongo filter: projects that have reached PO or plant (not quotation-only pipeline).
 */
const buildFinancialLeadMatch = (extra = {}) => ({
  ...FINANCIAL_LEAD_EXclusions,
  ...extra,
  $or: [
    { isRaisedToPO: true },
    { lifecycleStatus: { $in: FINANCIAL_TRACKING_LIFECYCLE_STAGES } },
  ],
})

const appendFinancialLeadScope = (filter = {}) => ({
  $and: [filter, buildFinancialLeadMatch()],
})

const distinctFinancialLeadIds = async (extraLeadFilter = {}) =>
  Lead.find(buildFinancialLeadMatch(extraLeadFilter)).distinct('_id')

const isLeadInFinancialScope = async (leadId) => {
  if (!leadId) return false
  const id = leadId instanceof mongoose.Types.ObjectId ? leadId : new mongoose.Types.ObjectId(String(leadId))
  return Boolean(await Lead.exists({ _id: id, ...buildFinancialLeadMatch() }))
}

/** Restrict invoice/expense/WIP queries to financially tracked projects. */
const applyFinancialLeadScopeToProjectFilter = async (filter = {}) => {
  const out = { ...filter }
  if (out.leadId) {
    if (out.leadId.$in) {
      const scoped = await distinctFinancialLeadIds()
      const allowed = new Set(scoped.map(String))
      const narrowed = out.leadId.$in.filter((id) => allowed.has(String(id)))
      return { ...out, leadId: { $in: narrowed } }
    }
    const ok = await isLeadInFinancialScope(out.leadId)
    return ok ? out : { ...out, leadId: { $in: [] } }
  }
  const ids = await distinctFinancialLeadIds()
  return { ...out, leadId: { $in: ids } }
}

module.exports = {
  FINANCIAL_TRACKING_LIFECYCLE_STAGES,
  buildFinancialLeadMatch,
  appendFinancialLeadScope,
  distinctFinancialLeadIds,
  isLeadInFinancialScope,
  applyFinancialLeadScopeToProjectFilter,
}
