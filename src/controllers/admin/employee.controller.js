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
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../../config/constants')
const { enrichLeadDocument } = require('../../utils/leadProjectId')
const { formatLog, getEmployeesAuditLog } = require('../../services/auditActivity.service')
const EMPLOYEE_BASE_FILTER = { role: { $ne: 'admin' } }
const EMAIL_SEND_TIMEOUT_MS = 5000
const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false
  return fallback
}

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

const requireMainAdminForAdminMutation = async (req, res) => {
  const requester = await User.findById(req.user._id).select('_id role isMainAdmin')
  if (!requester || requester.role !== 'admin') {
    forbidden(res, 'Only admins can perform this action')
    return null
  }
  if (!requester.isMainAdmin) {
    forbidden(res, 'Only main admin can create or manage admin users')
    return null
  }
  return requester
}

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [total, active, byRole] = await Promise.all([
    User.countDocuments({ ...dateFilter, ...EMPLOYEE_BASE_FILTER }),
    User.countDocuments({ ...dateFilter, ...EMPLOYEE_BASE_FILTER, isActive: true }),
    User.aggregate([
      { $match: { ...dateFilter, ...EMPLOYEE_BASE_FILTER } },
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

  const filter = { ...dateFilter, ...EMPLOYEE_BASE_FILTER }
  if (role && String(role).toLowerCase() !== 'admin') filter.role = role
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
  const { name, email, phone, role, password, department, permissions, isActive } = req.body
  if (String(role || '').toLowerCase() === 'admin') {
    const requester = await requireMainAdminForAdminMutation(req, res)
    if (!requester) return
  }

  const normalizedEmail = String(email || '').toLowerCase().trim()
  const exists = await User.findOne({ email: normalizedEmail })
  if (exists) return badRequest(res, 'Email already in use')

  const hashed = await bcrypt.hash(password, 12)

  const userPayload = {
    name,
    email: normalizedEmail,
    password: hashed,
    phone,
    role,
  }
  if (department !== undefined) userPayload.department = department
  if (permissions !== undefined) userPayload.permissions = permissions
  if (isActive !== undefined) userPayload.isActive = toBoolean(isActive, true)

  const user = await User.create(userPayload)

  if (role === 'sales') await roundRobinService.rebuildTracker()

  let credentialsEmailSent = true
  let credentialsEmailWarning = null
  try {
    const emailSendResult = await Promise.race([
      mailer
        .sendEmployeeCredentials({
          toEmail: user.email, name: user.name, role: user.role, tempPassword: password,
        })
        .then(() => ({ ok: true }))
        .catch((err) => ({ ok: false, err })),
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ ok: false, err: new Error('Credentials email timed out') }),
          EMAIL_SEND_TIMEOUT_MS
        )
      ),
    ])

    if (!emailSendResult?.ok) {
      credentialsEmailSent = false
      credentialsEmailWarning = emailSendResult?.err?.message || 'Failed to send credentials email'
      console.error('[Employee] send credentials failed:', credentialsEmailWarning)
    }
  } catch (err) {
    credentialsEmailSent = false
    credentialsEmailWarning = err.message || 'Failed to send credentials email'
    console.error('[Employee] send credentials failed:', credentialsEmailWarning)
  }

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.USER_CREATED,
    performedBy: req.user._id,
    metadata: { name, email, role, credentialsEmailSent, credentialsEmailWarning },
  })

  return created(
    res,
    { user, credentialsEmailSent, credentialsEmailWarning },
    credentialsEmailSent
      ? 'Employee created successfully'
      : 'Employee created, but credentials email could not be sent'
  )
})

exports.getEmployeeDetail = asyncHandler(async (req, res) => {
  const { userId } = req.params

  const employee = await User.findOne({ _id: userId, ...EMPLOYEE_BASE_FILTER }).select('-password').lean()
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
  const { name, email, phone, role, isActive, department, permissions } = req.body

  const employee = await User.findOne({ _id: userId, ...EMPLOYEE_BASE_FILTER })
  if (!employee) return notFound(res, 'Employee not found')
  const nextRole = role !== undefined ? String(role).toLowerCase() : undefined
  const normalizedIsActive = isActive !== undefined ? toBoolean(isActive, employee.isActive) : undefined
  if (employee.role === 'admin' || nextRole === 'admin') {
    const requester = await requireMainAdminForAdminMutation(req, res)
    if (!requester) return
    if (employee.isMainAdmin && nextRole && nextRole !== 'admin') {
      return badRequest(res, 'Main admin role cannot be changed')
    }
    if (employee.isMainAdmin && normalizedIsActive === false) {
      return badRequest(res, 'Main admin cannot be deactivated')
    }
  }

  const prevRole = employee.role
  const prevActive = employee.isActive
  const prevEmail = String(employee.email || '').toLowerCase().trim()

  let nextEmail = undefined
  if (email !== undefined) {
    nextEmail = String(email || '').toLowerCase().trim()
    if (!nextEmail) return badRequest(res, 'Email is required')
    if (nextEmail !== prevEmail) {
      const duplicate = await User.findOne({ email: nextEmail, _id: { $ne: employee._id } }).select('_id')
      if (duplicate) return badRequest(res, 'Email already in use')
    }
  }

  if (name !== undefined)       employee.name       = name
  if (nextEmail !== undefined)  employee.email      = nextEmail
  if (phone !== undefined)      employee.phone      = phone
  if (role !== undefined)       employee.role       = role
  if (normalizedIsActive !== undefined) employee.isActive = normalizedIsActive
  if (department !== undefined) employee.department = department
  if (permissions !== undefined) employee.permissions = permissions

  let credentialsEmailSent = true
  let credentialsEmailWarning = null
  if (nextEmail !== undefined && nextEmail !== prevEmail) {
    const tempPassword =
      Math.random().toString(36).slice(-6) +
      Math.random().toString(36).slice(-4).toUpperCase()
    employee.password = await bcrypt.hash(tempPassword, 12)
    employee.passwordChangedAt = new Date()

    try {
      const emailSendResult = await Promise.race([
        mailer
          .sendEmployeeCredentials({
            toEmail: nextEmail,
            name: employee.name,
            role: employee.role,
            tempPassword,
          })
          .then(() => ({ ok: true }))
          .catch((err) => ({ ok: false, err })),
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ ok: false, err: new Error('Updated credentials email timed out') }),
            EMAIL_SEND_TIMEOUT_MS
          )
        ),
      ])

      if (!emailSendResult?.ok) {
        credentialsEmailSent = false
        credentialsEmailWarning = emailSendResult?.err?.message || 'Failed to send updated credentials email'
        console.error('[Employee] updated credentials email failed:', credentialsEmailWarning)
      }
    } catch (err) {
      credentialsEmailSent = false
      credentialsEmailWarning = err.message || 'Failed to send updated credentials email'
      console.error('[Employee] updated credentials email failed:', credentialsEmailWarning)
    }
  }

  await employee.save()

  // Rebuild tracker if sales-relevant fields changed
  const salesRelevantChange =
    (role !== undefined && role !== prevRole) ||
    (normalizedIsActive !== undefined && normalizedIsActive !== prevActive)

  if (salesRelevantChange) await roundRobinService.rebuildTracker()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.USER_UPDATED,
    performedBy: req.user._id,
    metadata: {
      userId,
      changes: { name, email: nextEmail, phone, role, isActive: employee.isActive },
      credentialsEmailSent,
      credentialsEmailWarning,
    },
  })

  return success(
    res,
    { employee, credentialsEmailSent, credentialsEmailWarning },
    credentialsEmailSent
      ? 'Employee updated successfully'
      : 'Employee updated, but updated credentials email could not be sent'
  )
})

exports.getEmployeeAssignedLeads = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { page = 1, limit = 20 } = req.query

  const employee = await User.findOne({ _id: userId, ...EMPLOYEE_BASE_FILTER }).select('_id name email role isActive').lean()
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

  const employee = await User.findOne({ _id: userId, ...EMPLOYEE_BASE_FILTER }).lean()
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
  const employee = await User.findOne({ _id: req.params.userId, ...EMPLOYEE_BASE_FILTER })
  if (!employee) return notFound(res, 'Employee not found')

  employee.isActive = !employee.isActive
  await employee.save()

  if (employee.role === 'sales') await roundRobinService.rebuildTracker()

  return success(res, { employee }, `Employee marked ${employee.isActive ? 'active' : 'inactive'}`)
})

exports.deleteEmployee = asyncHandler(async (req, res) => {
  const { userId } = req.params

  const employee = await User.findOne({ _id: userId, ...EMPLOYEE_BASE_FILTER })
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
  const employee = await User.findOne({ _id: req.params.userId, ...EMPLOYEE_BASE_FILTER })
  if (!employee) return notFound(res, 'Employee not found')
  if (!employee.isActive) return badRequest(res, 'Cannot reset password for inactive employee')

  const tempPassword = Math.random().toString(36).slice(-6) +
    Math.random().toString(36).slice(-4).toUpperCase()
  employee.password = await bcrypt.hash(tempPassword, 12)
  employee.passwordChangedAt = new Date()
  await employee.save()

  await auditService.log({
    type: 'user',
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    performedBy: req.user._id,
    metadata: {
      userId: String(employee._id),
      email: employee.email,
      role: employee.role,
      source: 'admin_employee_reset',
    },
  })

  let credentialsEmailSent = true
  let credentialsEmailWarning = null
  try {
    await mailer.sendEmployeeCredentials({
      toEmail: employee.email, name: employee.name, role: employee.role, tempPassword
    })
  } catch (err) {
    credentialsEmailSent = false
    credentialsEmailWarning = err.message || 'Failed to send credentials email'
    console.error('[Employee] reset credentials email failed:', credentialsEmailWarning)
  }

  return success(
    res,
    { credentialsEmailSent, credentialsEmailWarning },
    credentialsEmailSent
      ? 'New credentials sent to employee email'
      : 'Password reset complete, but credentials email could not be sent'
  )
})
