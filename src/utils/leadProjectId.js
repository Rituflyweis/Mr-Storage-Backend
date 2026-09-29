const { getBusinessUnitLabel } = require('./businessUnit')

/**
 * FE may use either `jobId` or `projectId` — both are the lead's project id
 * (year format like 2026001; older projects keep legacy PRO-xxx ids).
 */
const resolveJobId = (leadOrJobId) => {
  if (leadOrJobId == null) return ''
  if (typeof leadOrJobId === 'string') return leadOrJobId
  return leadOrJobId.jobId || ''
}

const withProjectIdFields = (payload, jobIdSource) => {
  const jobId = resolveJobId(jobIdSource)
  return { ...payload, jobId, projectId: jobId }
}

const enrichLeadDocument = (lead) => {
  if (!lead || typeof lead !== 'object') return lead
  const plain = typeof lead.toObject === 'function' ? lead.toObject() : lead
  const jobId = plain.jobId || ''
  const businessUnit = plain.businessUnit || null
  return {
    ...plain,
    jobId,
    projectId: jobId,
    businessUnit,
    businessUnitLabel: getBusinessUnitLabel(businessUnit),
  }
}

module.exports = {
  resolveJobId,
  withProjectIdFields,
  enrichLeadDocument,
}
