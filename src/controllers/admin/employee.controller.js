const bcrypt = require('bcryptjs')
const User = require('../../models/User')
const Lead = require('../../models/Lead')
const FollowUp = require('../../models/FollowUp')
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
const Escalation = require('../../models/Escalation')
const Task = require('../../models/Task')
const Delivery = require('../../models/Delivery')
const MaterialRequest = require('../../models/MaterialRequest')
const POOrder = require('../../models/POOrder')
const SMDTItem = require('../../models/SMDTItem')
const roundRobinService = require('../../services/roundRobin.service')
const auditService = require('../../services/audit.service')
const mailer = require('../../services/email/mailer')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../../config/constants')
const { enrichLeadDocument } = require('../../utils/leadProjectId')
const { formatLog, getEmployeesAuditLog } = require('../../services/auditActivity.service')

const mapEmployeeLeadRow = (lead) => {
  const jobId = lead.jobId || ''
  return {
    leadId: lead._id,
    clientName: lead.customerId?.firstName || '',
    jobId,
    projectId: jobId,
    projectName: lead.projectName || '',
    location: lead.location || '',
    lifecycleStatus: lead.lifecycleStatus,
    quoteValue: lead.quoteValue ?? 0,
    isTerminated: !!lead.isTerminated,
    createdAt: lead.createdAt,
    lead: enrichLeadDocument(lead),
  }
}

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [total, active, byRole, topPerformerAgg] = await Promise.all([
    User.countDocuments({ ...dateFilter, role: { $ne: 'admin' } }),
    User.countDocuments({ ...dateFilter, role: { $ne: 'admin' }, isActive: true }),
    User.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: { assignedSales: { $ne: null }, lifecycleStatus: { $in: CLOSED_STAGES } } },
      { $group: { _id: '$assignedSales', closedLeads: { $sum: 1 } } },
      { $sort: { closedLeads: -1 } },
      { $limit: 1 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'employee' } },
      { $unwind: '$employee' },
      { $project: { _id: 0, employeeId: '$employee._id', name: '$employee.name', closedLeads: 1 } },
    ]),
  ])

  return success(res, {
    total,
    active,
    byRole,
    topPerformer: topPerformerAgg[0] || null,
  })
})

// GET /admin/employees/performance — "Sales Employee Performance" screen: revenue
// distribution pie chart + per-employee breakdown. Commission has no backend field yet
// (no rate is stored anywhere per employee), so it is intentionally omitted rather than
// faked — add a commissionRate field to User if that needs to become real.
exports.getPerformance = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const employees = await User.find({ role: 'sales', ...dateFilter }).lean()

  const performance = await Promise.all(
    employees.map(async (emp) => {
      const [totalLeads, closedLeads, revenueAgg] = await Promise.all([
        Lead.countDocuments({ assignedSales: emp._id }),
        Lead.countDocuments({ assignedSales: emp._id, lifecycleStatus: { $in: CLOSED_STAGES } }),
        Invoice.aggregate([
          { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
          { $unwind: '$lead' },
          { $match: { 'lead.assignedSales': emp._id, status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ]),
      ])
      return {
        employee: { _id: emp._id, name: emp.name, email: emp.email },
        totalLeads,
        closedLeads,
        conversionRate: totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0,
        revenue: revenueAgg[0]?.total || 0,
      }
    })
  )

  const totalRevenue = performance.reduce((sum, p) => sum + p.revenue, 0)
  const withShare = performance
    .map((p) => ({ ...p, revenueSharePercent: totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)

  const topPerformer = withShare[0] || null

  return success(res, {
    performance: withShare,
    totalRevenue,
    totalDeals: performance.reduce((sum, p) => sum + p.closedLeads, 0),
    topPerformer,
  })
})

exports.getEmployeesAuditLog = asyncHandler(async (req, res) => {
  const result = await getEmployeesAuditLog(req.query)
  return success(res, result)
})

exports.getAllEmployees = asyncHandler(async (req, res) => {
  const { role, isActive, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (role) filter.role = role
  if (isActive !== undefined) filter.isActive = isActive === 'true'

  const { search } = req.query
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ]
  }

  const skip = (parseInt(page) - 1) * parseInt(limit)
  const employees = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean()

  // The directory's work-volume column means something different per role — a lead count
  // is meaningless for a plant/construction/account employee — so compute the metric that
  // actually applies to each row instead of blanket-counting leads for everyone.
  const withCounts = await Promise.all(
    employees.map(async (emp) => {
      let workCount = 0
      let workLabel = ''
      if (emp.role === 'sales') {
        workCount = await Lead.countDocuments({ assignedSales: emp._id })
        workLabel = 'Leads'
      } else if (emp.role === 'construction') {
        workCount = await Task.countDocuments({ assignedTo: emp._id })
        workLabel = 'Tasks'
      } else if (emp.role === 'plant') {
        workCount = await POOrder.countDocuments({ assignedTo: emp._id })
        workLabel = 'PO Orders'
      } else if (emp.role === 'account') {
        workCount = await Invoice.countDocuments({ createdBy: emp._id })
        workLabel = 'Invoices'
      }
      return {
        ...emp,
        assignedLeadCount: emp.role === 'sales' ? workCount : 0, // kept for backward compatibility
        workCount,
        workLabel,
      }
    })
  )

  const total = await User.countDocuments(filter)
  return success(res, { employees: withCounts, total })
})

exports.createEmployee = asyncHandler(async (req, res) => {
  const { name, email, phone, role, password } = req.body

  const exists = await User.findOne({ email: email.toLowerCase().trim() })
  if (exists) return badRequest(res, 'Email already in use')

  const tempPassword = Math.random().toString(36).slice(-6) +
    Math.random().toString(36).slice(-4).toUpperCase()
  const hashed = await bcrypt.hash(tempPassword, 12)
  const { department, permissions } = req.body
  const user = await User.create({ name, email: email.toLowerCase().trim(), password: hashed, phone, role, department, permissions })

  if (role === 'sales') await roundRobinService.rebuildTracker()

  await mailer.sendEmployeeCredentials({
    toEmail: user.email, name: user.name, role: user.role, tempPassword: password,
  })

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.USER_CREATED,
    performedBy: req.user._id,
    metadata: { name, email, role },
  })

  return created(res, { user })
})

// Sales employees are measured by their lead pipeline; every other role works against
// operational records instead (tasks, deliveries, PO orders, invoices) so the detail
// page shows a section that actually maps to what that role does day to day.
const getSalesDetail = async (employee) => {
  const [assignedLeads, followUpsTotal, followUpsCompleted, quotationsCreated, escalationsRaised, revenueAgg] =
    await Promise.all([
      Lead.find({ assignedSales: employee._id })
        .populate({ path: 'customerId', select: 'firstName lastName email customerId' })
        .sort({ createdAt: -1 })
        .lean(),
      FollowUp.countDocuments({ assignedTo: employee._id }),
      FollowUp.countDocuments({ assignedTo: employee._id, status: 'completed' }),
      Quotation.countDocuments({ createdBy: employee._id }),
      Escalation.countDocuments({ raisedBy: employee._id }),
      Invoice.aggregate([
        { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
        { $unwind: '$lead' },
        { $match: { 'lead.assignedSales': employee._id, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
    ])

  const activeLeads = []
  const closedLeads = []
  for (const lead of assignedLeads) {
    const row = mapEmployeeLeadRow(lead)
    if (CLOSED_STAGES.includes(lead.lifecycleStatus)) closedLeads.push(row)
    else if (!lead.isTerminated) activeLeads.push(row)
  }

  const totalLeads = assignedLeads.length
  const closedCount = closedLeads.length

  return {
    section: 'sales',
    activeLeads,
    closedLeads,
    stats: {
      totalLeads,
      activeLeadsCount: activeLeads.length,
      closedLeadsCount: closedCount,
      conversionRate: totalLeads > 0 ? Math.round((closedCount / totalLeads) * 100) : 0,
      followUpsTotal,
      followUpsCompleted,
      followUpsCompletedPercentage: followUpsTotal > 0 ? Math.round((followUpsCompleted / followUpsTotal) * 100) : 0,
      quotationsCreated,
      escalationsRaised,
      revenueGenerated: revenueAgg[0]?.total || 0,
    },
  }
}

const getConstructionDetail = async (employee) => {
  const [tasksTotal, tasksDone, tasksInProgress, recentTasks, materialRequestsRaised, deliveriesUpdated] =
    await Promise.all([
      Task.countDocuments({ assignedTo: employee._id }),
      Task.countDocuments({ assignedTo: employee._id, status: 'done' }),
      Task.countDocuments({ assignedTo: employee._id, status: 'in_progress' }),
      Task.find({ assignedTo: employee._id })
        .populate({ path: 'leadId', select: 'projectName jobId' })
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean(),
      MaterialRequest.countDocuments({ requestedBy: employee._id }),
      Delivery.countDocuments({ 'statusHistory.changedBy': employee._id }),
    ])

  return {
    section: 'construction',
    recentTasks,
    stats: {
      tasksTotal,
      tasksDone,
      tasksInProgress,
      tasksCompletionRate: tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0,
      materialRequestsRaised,
      deliveriesUpdated,
    },
  }
}

const getPlantDetail = async (employee) => {
  const [poOrdersAssigned, poOrdersCompleted, recentPOOrders, deliveriesUpdated, smdtItemsManaged] =
    await Promise.all([
      POOrder.countDocuments({ assignedTo: employee._id }),
      POOrder.countDocuments({ assignedTo: employee._id, status: 'approved' }),
      POOrder.find({ assignedTo: employee._id })
        .populate({ path: 'leadId', select: 'projectName jobId' })
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean(),
      Delivery.countDocuments({ 'statusHistory.changedBy': employee._id }),
      SMDTItem.countDocuments({ $or: [{ addedBy: employee._id }, { lastUpdatedBy: employee._id }] }),
    ])

  return {
    section: 'plant',
    recentPOOrders,
    stats: {
      poOrdersAssigned,
      poOrdersCompleted,
      deliveriesUpdated,
      smdtItemsManaged,
    },
  }
}

const getAccountDetail = async (employee) => {
  const [invoicesCreated, invoicesMarkedPaid, recentInvoices, revenueCollectedAgg] = await Promise.all([
    Invoice.countDocuments({ createdBy: employee._id }),
    Invoice.countDocuments({ paidBy: employee._id }),
    Invoice.find({ paidBy: employee._id }).sort({ updatedAt: -1 }).limit(20).lean(),
    Invoice.aggregate([
      { $match: { paidBy: employee._id, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
  ])

  return {
    section: 'account',
    recentInvoices,
    stats: {
      invoicesCreated,
      invoicesMarkedPaid,
      revenueCollected: revenueCollectedAgg[0]?.total || 0,
    },
  }
}

exports.getEmployeeDetail = asyncHandler(async (req, res) => {
  const { userId } = req.params

  const employee = await User.findById(userId).select('-password').lean()
  if (!employee) return notFound(res, 'Employee not found')

  const roleDetail =
    employee.role === 'sales' ? await getSalesDetail(employee) :
    employee.role === 'construction' ? await getConstructionDetail(employee) :
    employee.role === 'plant' ? await getPlantDetail(employee) :
    employee.role === 'account' ? await getAccountDetail(employee) :
    { section: 'admin', stats: {} } // admin has no operational pipeline of its own

  return success(res, { employee, ...roleDetail })
})

exports.updateEmployee = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { name, phone, role, isActive, department, permissions } = req.body

  const employee = await User.findById(userId)
  if (!employee) return notFound(res, 'Employee not found')

  const prevRole = employee.role
  const prevActive = employee.isActive

  if (name !== undefined)       employee.name       = name
  if (phone !== undefined)      employee.phone      = phone
  if (role !== undefined)       employee.role       = role
  if (isActive !== undefined)   employee.isActive   = isActive
  if (department !== undefined) employee.department = department
  if (permissions !== undefined) employee.permissions = permissions

  await employee.save()

  // Rebuild tracker if sales-relevant fields changed
  const salesRelevantChange =
    (role !== undefined && role !== prevRole) ||
    (isActive !== undefined && isActive !== prevActive)

  if (salesRelevantChange) await roundRobinService.rebuildTracker()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.USER_UPDATED,
    performedBy: req.user._id,
    metadata: { userId, changes: { name, phone, role, isActive } },
  })

  return success(res, { employee })
})

exports.getEmployeeAssignedLeads = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { page = 1, limit = 20 } = req.query

  const employee = await User.findById(userId).select('_id name email role isActive').lean()
  if (!employee) return notFound(res, 'Employee not found')

  const dateFilter = buildDateFilter(req.query)
  const filter = { assignedSales: userId, ...dateFilter }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: 'firstName lastName email customerId' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const rows = leads.map((lead) => {
    const jobId = lead.jobId || ''
    return {
      clientName: lead.customerId?.firstName || '',
      jobId,
      projectId: jobId,
      location: lead.location || '',
      status: lead.lifecycleStatus,
      quoteValue: lead.quoteValue ?? 0,
      lead: enrichLeadDocument(lead),
    }
  })

  return success(res, {
    employee,
    leads: rows,
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.getEmployeeTimeline = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const employee = await User.findById(userId).lean()
  if (!employee) return notFound(res, 'Employee not found')

  // AuditLog.performedBy is this employee — shows everything they did
  const AuditLog = require('../../models/AuditLog')

  const timeline = await AuditLog.find({
    performedBy: userId,
    ...dateFilter,
  })
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .populate({ path: 'customerId', select: 'firstName email customerId' })
    .sort({ createdAt: -1 })
    .lean()

  const entries = timeline.map((log) => ({
    ...log,
    displayMessage: formatLog(log),
  }))

  return success(res, { employee, timeline: entries })
})

exports.toggleStatus = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.userId)
  if (!employee) return notFound(res, 'Employee not found')

  employee.isActive = !employee.isActive
  await employee.save()

  if (employee.role === 'sales') await roundRobinService.rebuildTracker()

  return success(res, { employee }, `Employee marked ${employee.isActive ? 'active' : 'inactive'}`)
})

exports.deleteEmployee = asyncHandler(async (req, res) => {
  const { userId } = req.params

  const employee = await User.findById(userId)
  if (!employee) return notFound(res, 'Employee not found')

  const activeLeadCount = await Lead.countDocuments({ assignedSales: userId, isTerminated: { $ne: true } })
  if (activeLeadCount > 0) {
    return badRequest(res, `Cannot delete — this employee has ${activeLeadCount} active assigned lead(s). Reassign them first.`)
  }

  await User.findByIdAndDelete(userId)

  if (employee.role === 'sales') await roundRobinService.rebuildTracker()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.USER_DELETED,
    performedBy: req.user._id,
    metadata: { userId, name: employee.name, email: employee.email, role: employee.role },
  })

  return success(res, {}, 'Employee deleted')
})

exports.resetPassword = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.userId)
  if (!employee) return notFound(res, 'Employee not found')
  if (!employee.isActive) return badRequest(res, 'Cannot reset password for inactive employee')

  const tempPassword = Math.random().toString(36).slice(-6) +
    Math.random().toString(36).slice(-4).toUpperCase()
  employee.password = await bcrypt.hash(tempPassword, 12)
  await employee.save()

  await mailer.sendEmployeeCredentials({
    toEmail: employee.email, name: employee.name, role: employee.role, tempPassword
  })

  return success(res, {}, 'New credentials sent to employee email')
})
