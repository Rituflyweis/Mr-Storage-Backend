const { AUDIT_ACTIONS } = require('../config/constants')
const auditService = require('../services/audit.service')
const {
  resolvePanelFromRequest,
  resolveActorFromRequest,
  buildRequestAuditMeta,
  inferEntityFromParams,
  actionForHttpMethod,
} = require('../utils/auditContext.util')

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const SKIP_EXACT_PATHS = new Set([
  '/health',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/customer/auth/login',
  '/api/customer/auth/refresh',
])

const SKIP_PATH_INCLUDES = [
  '/upload',
  '/presigned-url',
  '/download',
  '/export',
  '/webhook',
]

const auditTypeForPanel = (panel) => {
  if (panel === 'construction') return 'construction'
  if (panel === 'account') return 'payment'
  if (panel === 'customer') return 'lead'
  if (panel === 'plant' || panel === 'admin') return 'plant'
  return 'activity'
}

const FALLBACK_AUDIT_PREFIXES = ['/api/construction', '/api/account']

const auditMutationMiddleware = (req, res, next) => {
  if (!MUTATION_METHODS.has(req.method)) return next()

  const pathOnly = req.originalUrl?.split('?')[0] || req.path || ''
  if (SKIP_EXACT_PATHS.has(pathOnly)) return next()
  if (SKIP_PATH_INCLUDES.some((s) => pathOnly.includes(s))) return next()
  if (!FALLBACK_AUDIT_PREFIXES.some((p) => pathOnly.startsWith(p))) return next()

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return
    if (req.auditLogged) return

    const actor = resolveActorFromRequest(req)
    if (actor.actorType === 'anonymous' && !pathOnly.startsWith('/api/public')) return

    const panel = resolvePanelFromRequest(req)
    const { entityType, entityId } = inferEntityFromParams(req)
    const leadId = req.params?.leadId || null

    const actionKey = actionForHttpMethod(req.method)
    const action =
      actionKey === 'entity.created'
        ? AUDIT_ACTIONS.ENTITY_CREATED
        : actionKey === 'entity.deleted'
          ? AUDIT_ACTIONS.ENTITY_DELETED
          : AUDIT_ACTIONS.ENTITY_UPDATED

    auditService.log({
      type: auditTypeForPanel(panel),
      action,
      leadId,
      customerId: actor.customerId || null,
      performedBy: actor.performedBy,
      actorType: actor.actorType,
      actorId: actor.actorId,
      panel,
      entityType,
      entityId,
      httpMethod: req.method,
      path: pathOnly,
      metadata: buildRequestAuditMeta(req, {
        summary: `${req.method} ${pathOnly}`,
        fallback: true,
      }),
    })
  })

  next()
}

module.exports = auditMutationMiddleware
