const AuditLog = require('../models/AuditLog')

/**
 * Single write point for all audit logs.
 * Call this everywhere. Never write to AuditLog directly outside this file.
 * Fails silently — an audit failure should never break a business action.
 */
const log = async ({ type, action, leadId = null, customerId = null, performedBy = null, metadata = {} }) => {
  try {
    await AuditLog.create({ type, action, leadId, customerId, performedBy, metadata })
  } catch (err) {
    console.error('[AuditLog] Write failed:', err.message)
  }
}

module.exports = { log }
