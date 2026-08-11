/**
 * FE may use either `jobId` or `projectId` — both are the lead's PRO-xxx id.
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
  return { ...plain, jobId, projectId: jobId }
}

module.exports = {
  resolveJobId,
  withProjectIdFields,
  enrichLeadDocument,
}
