const AuditLog = require('../models/AuditLog')
const {
  resolvePanelFromRequest,
  resolveActorFromRequest,
  buildRequestAuditMeta,
} = require('../utils/auditContext.util')

/**
 * Single write point for all audit logs.
 * Fails silently — an audit failure should never break a business action.
 */
const log = async ({
  req = null,
  type,
  action,
  leadId = null,
  customerId = null,
  performedBy = null,
  metadata = {},
  actorType = null,
  actorId = null,
  panel = null,
  entityType = null,
  entityId = null,
  httpMethod = null,
  path = null,
}) => {
  if (req) req.auditLogged = true
  try {
    const doc = {
      type,
      action,
      leadId,
      customerId,
      performedBy,
      metadata,
    }
    if (actorType) doc.actorType = actorType
    if (actorId) doc.actorId = actorId
    if (panel) doc.panel = panel
    if (entityType) doc.entityType = entityType
    if (entityId) doc.entityId = entityId
    if (httpMethod) doc.httpMethod = httpMethod
    if (path) doc.path = path

    await AuditLog.create(doc)
  } catch (err) {
    console.error('[AuditLog] Write failed:', err.message)
  }
}

/** Log with actor + HTTP context from Express request */
const logFromRequest = async (req, payload) => {
  if (!req) return log(payload)

  const actor = resolveActorFromRequest(req)
  const panel = payload.panel || resolvePanelFromRequest(req) || actor.panel
  const meta = buildRequestAuditMeta(req, payload.metadata || {})

  return log({
    req,
    ...payload,
    performedBy: payload.performedBy !== undefined ? payload.performedBy : actor.performedBy,
    customerId: payload.customerId !== undefined ? payload.customerId : actor.customerId || null,
    actorType: payload.actorType || actor.actorType,
    actorId: payload.actorId !== undefined ? payload.actorId : actor.actorId,
    panel,
    httpMethod: payload.httpMethod || req.method,
    path: payload.path || meta.path,
    metadata: {
      ...meta,
      actorEmail: actor.actorEmail,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      ...(payload.metadata || {}),
    },
  })
}

module.exports = { log, logFromRequest }
