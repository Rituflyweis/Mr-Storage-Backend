/** Normalize list query projectId / leadId to a single lead filter value. */
const resolveProjectLeadId = (query = {}) => {
  const raw = query.projectId || query.leadId
  if (!raw) return null
  return String(raw).trim()
}

module.exports = { resolveProjectLeadId }
