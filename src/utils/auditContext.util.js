const { USER_ROLES } = require('../config/constants')

const PANEL_PREFIXES = [
  { prefix: '/api/admin', panel: 'admin' },
  { prefix: '/api/sales', panel: 'sales' },
  { prefix: '/api/plant', panel: 'plant' },
  { prefix: '/api/construction', panel: 'construction' },
  { prefix: '/api/account', panel: 'account' },
  { prefix: '/api/customer', panel: 'customer' },
  { prefix: '/api/public', panel: 'public' },
]

const resolvePanelFromRequest = (req) => {
  if (req.customer?._id) return 'customer'
  if (req.user?.role && USER_ROLES.includes(req.user.role)) return req.user.role
  const path = req.originalUrl?.split('?')[0] || req.path || ''
  for (const { prefix, panel } of PANEL_PREFIXES) {
    if (path.startsWith(prefix)) return panel
  }
  return null
}

const resolveActorFromRequest = (req) => {
  if (req.user?._id) {
    return {
      actorType: 'staff',
      actorId: req.user._id,
      performedBy: req.user._id,
      panel: req.user.role,
      actorEmail: req.user.email,
      actorName: req.user.name,
      actorRole: req.user.role,
    }
  }
  if (req.customer?._id) {
    return {
      actorType: 'customer',
      actorId: req.customer._id,
      performedBy: null,
      customerId: req.customer._id,
      panel: 'customer',
      actorEmail: req.customer.email,
    }
  }
  return {
    actorType: 'anonymous',
    actorId: null,
    performedBy: null,
    panel: resolvePanelFromRequest(req),
  }
}

const clientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  null

const buildRequestAuditMeta = (req, extra = {}) => ({
  path: req.originalUrl?.split('?')[0] || req.path,
  method: req.method,
  ip: clientIp(req),
  userAgent: req.headers['user-agent'] || null,
  ...extra,
})

const inferEntityFromParams = (req) => {
  const p = req.params || {}
  const pairs = [
    ['leadId', 'lead'],
    ['taskId', 'task'],
    ['milestoneId', 'milestone'],
    ['deliveryId', 'delivery'],
    ['requestId', 'material_request'],
    ['bundleId', 'bundle'],
    ['packingListId', 'packing_list'],
    ['userId', 'user'],
    ['customerId', 'customer'],
    ['invoiceId', 'invoice'],
    ['quotationId', 'quotation'],
  ]
  for (const [key, entityType] of pairs) {
    if (p[key]) return { entityType, entityId: p[key] }
  }
  return { entityType: null, entityId: null }
}

const actionForHttpMethod = (method) => {
  const m = String(method || '').toUpperCase()
  if (m === 'POST') return 'entity.created'
  if (m === 'DELETE') return 'entity.deleted'
  if (m === 'PUT' || m === 'PATCH') return 'entity.updated'
  return 'entity.updated'
}

module.exports = {
  resolvePanelFromRequest,
  resolveActorFromRequest,
  buildRequestAuditMeta,
  inferEntityFromParams,
  actionForHttpMethod,
  clientIp,
}
