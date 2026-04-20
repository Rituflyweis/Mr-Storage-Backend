const bcrypt = require('bcryptjs')
const User = require('../../models/User')
const Lead = require('../../models/Lead')
const FollowUp = require('../../models/FollowUp')
const Invoice = require('../../models/Invoice')
const roundRobinService = require('../../services/roundRobin.service')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../../config/constants')

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

exports.getAllEmployees = asyncHandler(async (req, res) => {
  const { role, isActive, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (role) filter.role = role
  if (isActive !== undefined) filter.isActive = isActive === 'true'

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
  const { name, email, password, phone, role } = req.body

  const exists = await User.findOne({ email: email.toLowerCase().trim() })
  if (exists) return badRequest(res, 'Email already in use')

  const hashed = await bcrypt.hash(password, 12)
  const user = await User.create({ name, email: email.toLowerCase().trim(), password: hashed, phone, role })

  if (role === 'sales') await roundRobinService.rebuildTracker()

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

  const employee = await User.findById(userId).lean()
  if (!employee) return notFound(res, 'Employee not found')

  const leads = await Lead.find({ assignedSales: userId })
    .populate('customerId')
    .sort({ createdAt: -1 })
    .lean()

  const closedLeads = leads.filter(l => CLOSED_STAGES.includes(l.lifecycleStatus))
  const completedFollowUps = await FollowUp.countDocuments({ assignedTo: userId, status: 'completed' })

  const revenueAgg = await Invoice.aggregate([
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
  ])

  return success(res, {
    employee,
    leads,
    stats: {
      totalLeads: leads.length,
      closedLeads: closedLeads.length,
      conversionRate: leads.length > 0 ? Math.round((closedLeads.length / leads.length) * 100) : 0,
      followUpsCompleted: completedFollowUps,
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
    .populate('leadId')
    .populate('customerId')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { employee, timeline })
})
