const AuditLog = require('../models/AuditLog')
const User = require('../models/User')
const { formatAuditActivityMessage } = require('../utils/auditActivityMessage')

const enrichLogContext = (log) => ({
  customerName: log.customerId?.firstName || '',
  projectName: log.leadId?.projectName || log.metadata?.projectName || '',
})

const formatLog = (log) => formatAuditActivityMessage(log, enrichLogContext(log))

const getLatestAuditByEmployee = async () => {
  const rows = await AuditLog.aggregate([
    { $match: { performedBy: { $ne: null } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$performedBy',
        action: { $first: '$action' },
        type: { $first: '$type' },
        leadId: { $first: '$leadId' },
        customerId: { $first: '$customerId' },
        metadata: { $first: '$metadata' },
        createdAt: { $first: '$createdAt' },
      },
    },
  ])

  if (!rows.length) return new Map()

  const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))]
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))]

  const Lead = require('../models/Lead')
  const Customer = require('../models/Customer')

  const [leads, customers] = await Promise.all([
    leadIds.length
      ? Lead.find({ _id: { $in: leadIds } })
          .select('projectName')
          .setOptions({ includeDeleted: true })
          .lean()
      : [],
    customerIds.length
      ? Customer.find({ _id: { $in: customerIds } }).select('firstName email').lean()
      : [],
  ])

  const leadMap = new Map(leads.map((l) => [String(l._id), l]))
  const customerMap = new Map(customers.map((c) => [String(c._id), c]))

  const map = new Map()
  for (const row of rows) {
    const log = {
      action: row.action,
      type: row.type,
      metadata: row.metadata || {},
      leadId: row.leadId ? leadMap.get(String(row.leadId)) || null : null,
      customerId: row.customerId ? customerMap.get(String(row.customerId)) || null : null,
      createdAt: row.createdAt,
    }
    map.set(String(row._id), {
      lastActivity: formatLog(log),
      lastActivityAt: row.createdAt,
    })
  }

  return map
}

const getEmployeesAuditLog = async (query = {}) => {
  const { role, isActive, search, page = 1, limit = 20 } = query

  const filter = {}
  if (role) filter.role = role
  if (isActive !== undefined) filter.isActive = isActive === 'true'
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    filter.$or = [{ name: regex }, { email: regex }]
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [employees, activityMap] = await Promise.all([
    User.find(filter).select('name email role isActive createdAt').lean(),
    getLatestAuditByEmployee(),
  ])

  const { resolveRolePanel } = require('../utils/auditActivityMessage')

  const rows = employees.map((emp) => {
    const activity = activityMap.get(String(emp._id))
    return {
      userId: emp._id,
      name: emp.name,
      email: emp.email,
      role: emp.role,
      panel: resolveRolePanel(emp.role),
      status: emp.isActive ? 'active' : 'inactive',
      isActive: emp.isActive,
      lastActivity: activity?.lastActivity ?? null,
      lastActivityAt: activity?.lastActivityAt ?? null,
    }
  })

  rows.sort((a, b) => {
    if (!a.lastActivityAt && !b.lastActivityAt) return a.name.localeCompare(b.name)
    if (!a.lastActivityAt) return 1
    if (!b.lastActivityAt) return -1
    return new Date(b.lastActivityAt) - new Date(a.lastActivityAt)
  })

  const total = rows.length
  const paged = rows.slice(skip, skip + parsedLimit)

  return { employees: paged, total, page: parsedPage, limit: parsedLimit }
}

module.exports = {
  formatLog,
  getEmployeesAuditLog,
  getLatestAuditByEmployee,
}
