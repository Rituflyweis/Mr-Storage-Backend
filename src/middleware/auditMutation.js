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

const API_ROUTE_PREFIXES = ['/api', '/sales']

const SKIP_EXACT_PATHS = new Set([
  '/health',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/customer/auth/login',
  '/api/customer/auth/refresh',
  '/api/customer/auth/logout',
])

/** Noisy or non-business paths — explicit audit elsewhere or not useful */
const SKIP_PATH_INCLUDES = [
  '/presigned-url',
  '/download',
  '/export',
  '/webhook',
  '/email-send-jobs/', // job polling
]

const auditTypeForPanel = (panel) => {
  switch (panel) {
    case 'construction':
      return 'construction'
    case 'account':
      return 'payment'
    case 'customer':
      return 'customer'
    case 'admin':
    case 'sales':
      return 'lead'
    case 'plant':
      return 'plant'
    case 'public':
      return 'activity'
    default:
      return 'activity'
  }
}

const isAuditedApiRoute = (pathOnly) =>
  API_ROUTE_PREFIXES.some((p) => pathOnly === p || pathOnly.startsWith(`${p}/`))

const auditMutationMiddleware = (req, res, next) => {
  if (!MUTATION_METHODS.has(req.method)) return next()

  const pathOnly = req.originalUrl?.split('?')[0] || req.path || ''
  if (!isAuditedApiRoute(pathOnly)) return next()
  if (SKIP_EXACT_PATHS.has(pathOnly)) return next()
  if (SKIP_PATH_INCLUDES.some((s) => pathOnly.includes(s))) return next()

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return
    if (req.auditLogged) return

    const actor = resolveActorFromRequest(req)
    const panel = resolvePanelFromRequest(req)
    const { entityType, entityId } = inferEntityFromParams(req)
    const leadId = req.params?.leadId || req.body?.leadId || null

    const actionKey = actionForHttpMethod(req.method)
    const action =
      actionKey === 'entity.created'
        ? AUDIT_ACTIONS.ENTITY_CREATED
        : actionKey === 'entity.deleted'
          ? AUDIT_ACTIONS.ENTITY_DELETED
          : AUDIT_ACTIONS.ENTITY_UPDATED

    auditService.log({
      req,
      type: auditTypeForPanel(panel),
      action,
      leadId,
      customerId: actor.customerId || req.body?.customerId || null,
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
