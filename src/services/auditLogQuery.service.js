const AuditLog = require('../models/AuditLog')
const User = require('../models/User')
const Customer = require('../models/Customer')
const { formatAuditActivityMessage } = require('../utils/auditActivityMessage')

const buildAuditLogFilter = (query = {}) => {
  const filter = {}
  const { panel, action, type, actorId, performedBy, leadId, customerId, from, to, search } = query

  if (panel) filter.panel = panel
  if (action) filter.action = action
  if (type) filter.type = type
  if (leadId) filter.leadId = leadId
  if (customerId) filter.customerId = customerId
  if (actorId) filter.actorId = actorId
  if (performedBy) filter.performedBy = performedBy

  if (from || to) {
    filter.createdAt = {}
    if (from) filter.createdAt.$gte = new Date(from)
    if (to) filter.createdAt.$lte = new Date(to)
  }

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    filter.$or = [
      { action: regex },
      { path: regex },
      { panel: regex },
      { entityType: regex },
    ]
  }

  return filter
}

const listAuditLogs = async (query = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200)
  const skip = (page - 1) * limit
  const filter = buildAuditLogFilter(query)

  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ])

  const staffIds = [...new Set(rows.map((r) => r.performedBy || r.actorId).filter(Boolean))]
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))]

  const [staff, customers] = await Promise.all([
    staffIds.length ? User.find({ _id: { $in: staffIds } }).select('name email role').lean() : [],
    customerIds.length ? Customer.find({ _id: { $in: customerIds } }).select('firstName lastName email').lean() : [],
  ])

  const staffMap = new Map(staff.map((u) => [String(u._id), u]))
  const customerMap = new Map(customers.map((c) => [String(c._id), c]))

  const logs = rows.map((row) => {
    const actorStaff = staffMap.get(String(row.performedBy || row.actorId))
    const actorCustomer = row.customerId ? customerMap.get(String(row.customerId)) : null
    const message = formatAuditActivityMessage(row, {
      customerName: actorCustomer ? `${actorCustomer.firstName || ''} ${actorCustomer.lastName || ''}`.trim() : '',
    })

    return {
      ...row,
      message,
      actor: actorStaff
        ? { type: 'staff', _id: actorStaff._id, name: actorStaff.name, email: actorStaff.email, role: actorStaff.role }
        : actorCustomer
          ? {
              type: 'customer',
              _id: actorCustomer._id,
              name: `${actorCustomer.firstName || ''} ${actorCustomer.lastName || ''}`.trim(),
              email: actorCustomer.email,
            }
          : row.actorType === 'anonymous'
            ? { type: 'anonymous' }
            : null,
    }
  })

  return { logs, total, page, limit, pages: Math.ceil(total / limit) || 1 }
}

module.exports = { listAuditLogs, buildAuditLogFilter }
