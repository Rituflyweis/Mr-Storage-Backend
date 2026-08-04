const bcrypt = require('bcryptjs')
const User = require('../../models/User')
const Lead = require('../../models/Lead')
const FollowUp = require('../../models/FollowUp')
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
const Escalation = require('../../models/Escalation')
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

  const [total, active, byRole] = await Promise.all([
    User.countDocuments({ ...dateFilter, role: { $ne: 'admin' } }),
    User.countDocuments({ ...dateFilter, role: { $ne: 'admin' }, isActive: true }),
    User.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
  ])

  return success(res, {
    total,
    active,
    byRole,
    topPerformer: null, // dummy for now
  })
})

exports.getPerformance = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const employees = await User.find({ role: 'sales', ...dateFilter }).lean()

  const performance = await Promise.all(
    employees.map(async (emp) => {
      const [totalLeads, closedLeads] = await Promise.all([
        Lead.countDocuments({ assignedSales: emp._id }),
        Lead.countDocuments({ assignedSales: emp._id, lifecycleStatus: { $in: CLOSED_STAGES } }),
      ])
      return {
        employee: { _id: emp._id, name: emp.name, email: emp.email },
        totalLeads,
        closedLeads,
        conversionRate: totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0,
      }
    })
  )

  return success(res, { performance })
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

  const withCounts = await Promise.all(
    employees.map(async (emp) => ({
      ...emp,
      assignedLeadCount: await Lead.countDocuments({ assignedSales: emp._id }),
    }))
  )

  const total = await User.countDocuments(filter)
  return success(res, { employees: withCounts, total })
})

exports.createEmployee = asyncHandler(async (req, res) => {
  const { name, email, phone, role, password } = req.body

  const exists = await User.findOne({ email: email.toLowerCase().trim() })
  if (exists) return badRequest(res, 'Email already in use')

  const hashed = await bcrypt.hash(password, 12)
  const user = await User.create({ name, email: email.toLowerCase().trim(), password: hashed, phone, role })

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

exports.getEmployeeDetail = asyncHandler(async (req, res) => {
  const { userId } = req.params

  const employee = await User.findById(userId).select('-password').lean()
  if (!employee) return notFound(res, 'Employee not found')

  const [
    assignedLeads,
    followUpsTotal,
    followUpsCompleted,
    quotationsCreated,
    escalationsRaised,
    revenueAgg,
  ] = await Promise.all([
    Lead.find({ assignedSales: userId })
      .populate({ path: 'customerId', select: 'firstName lastName email customerId' })
      .sort({ createdAt: -1 })
      .lean(),
    FollowUp.countDocuments({ assignedTo: userId }),
    FollowUp.countDocuments({ assignedTo: userId, status: 'completed' }),
    Quotation.countDocuments({ createdBy: userId }),
    Escalation.countDocuments({ raisedBy: userId }),
    Invoice.aggregate([
      {
        $lookup: {
          from: 'leads',
          localField: 'leadId',
          foreignField: '_id',
          as: 'lead',
        },
      },
      { $unwind: '$lead' },
      { $match: { 'lead.assignedSales': employee._id, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
  ])

  const activeLeads = []
  const closedLeads = []
  for (const lead of assignedLeads) {
    const row = mapEmployeeLeadRow(lead)
    if (CLOSED_STAGES.includes(lead.lifecycleStatus)) {
      closedLeads.push(row)
    } else if (!lead.isTerminated) {
      activeLeads.push(row)
    }
  }

  const totalLeads = assignedLeads.length
  const closedCount = closedLeads.length
  const followUpsCompletedPercentage = followUpsTotal > 0
    ? Math.round((followUpsCompleted / followUpsTotal) * 100)
    : 0

  return success(res, {
    employee,
    activeLeads,
    closedLeads,
    stats: {
      totalLeads,
      activeLeadsCount: activeLeads.length,
      closedLeadsCount: closedCount,
      conversionRate: totalLeads > 0 ? Math.round((closedCount / totalLeads) * 100) : 0,
      followUpsTotal,
      followUpsCompleted,
      followUpsCompletedPercentage,
      quotationsCreated,
      escalationsRaised,
      revenueGenerated: revenueAgg[0]?.total || 0,
    },
  })
})

exports.updateEmployee = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { name, phone, role, isActive } = req.body

  const employee = await User.findById(userId)
  if (!employee) return notFound(res, 'Employee not found')

  const prevRole = employee.role
  const prevActive = employee.isActive

  if (name !== undefined) employee.name = name
  if (phone !== undefined) employee.phone = phone
  if (role !== undefined) employee.role = role
  if (isActive !== undefined) employee.isActive = isActive

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
