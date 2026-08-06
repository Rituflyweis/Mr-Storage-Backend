const FollowUp = require('../../models/FollowUp')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const auditService = require('../../services/audit.service')
const followupScriptService = require('../../services/ai/followupScript.service')
const { success, created, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { scheduleFollowUpReminder } = require('../../utils/scheduler/followUpScheduler')

const isOverdue = (f) => f.status === 'pending' && new Date(f.followUpDate) < new Date()

const formatClientName = (customer) => {
  if (!customer) return ''
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()
}

const resolveFollowUpStatus = (followUp) => {
  if (followUp.status === 'completed') return 'completed'
  if (isOverdue(followUp)) return 'overdue'
  return 'pending'
}

const findNextFollowUpDate = (followUp, pendingByLeadId) => {
  const list = pendingByLeadId.get(String(followUp.leadId)) || []
  const after = new Date(followUp.followUpDate).getTime()
  const next = list.find(
    (p) => String(p._id) !== String(followUp._id) && new Date(p.followUpDate).getTime() > after
  )
  return next ? next.followUpDate : null
}

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const now = new Date()

  const all = await FollowUp.find(dateFilter).lean()
  const total = all.length
  const completed = all.filter(f => f.status === 'completed').length
  const overdue = all.filter(isOverdue).length
  const upcoming = all.filter(f => f.status === 'pending' && new Date(f.followUpDate) >= now).length

  return success(res, { total, upcoming, completed, overdue })
})

exports.getUpcoming = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'followUpDate')
  const filter = {
    status: 'pending',
    followUpDate: { $gte: new Date() },
    ...dateFilter,
  }

  const followups = await FollowUp.find(filter)
    .populate('leadId')
    .populate('assignedTo')
    .populate('customerId')
    .sort({ followUpDate: 1 })
    .lean()

  return success(res, { followups })
})

exports.createFollowUp = asyncHandler(async (req, res) => {
  const { leadId, assignedTo, followUpDate, notes, priority } = req.body
  const lead = await Lead.findById(leadId).select('customerId').lean()
  if (!lead) return notFound(res, 'Lead not found')
  const customerId = lead.customerId

  const followUp = await FollowUp.create({
    leadId,
    customerId,
    assignedTo,
    createdBy: req.user._id,
    followUpDate: new Date(followUpDate),
    notes: notes || '',
    priority: priority || 'medium',
  })

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_CREATED,
    leadId,
    customerId,
    performedBy: req.user._id,
    metadata: { followUpDate, priority, assignedTo },
  })

  scheduleFollowUpReminder(followUp)

  return created(res, { followUp })
})

exports.getKpi = asyncHandler(async (req, res) => {
  // Dummy values — replace with real aggregation later
  return success(res, {
    weeklyCount: 0,
    responseRate: 0,
    conversionRate: 0,
    avgResponseTimeHours: 0,
    note: 'KPI data will be calculated in a future release',
  })
})

exports.getAiScript = asyncHandler(async (req, res) => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date();   todayEnd.setHours(23, 59, 59, 999)

  const todaysFollowUps = await FollowUp.find({
    followUpDate: { $gte: todayStart, $lte: todayEnd },
    status: 'pending',
  }).lean()

  if (todaysFollowUps.length === 0) {
    return success(res, { scripts: [], message: 'No follow-ups scheduled for today' })
  }

  // Load context for each follow-up
  const withContext = await Promise.all(
    todaysFollowUps.map(async (followUp) => {
      const [lead, customer] = await Promise.all([
        Lead.findById(followUp.leadId).lean(),
        Customer.findById(followUp.customerId).lean(),
      ])
      return { followUp, lead, customer }
    })
  )

  const scripts = await followupScriptService.generateScripts(withContext)
  return success(res, { scripts })
})

exports.completeFollowUp = asyncHandler(async (req, res) => {
  const { followUpId } = req.params

  const followUp = await FollowUp.findById(followUpId)
  if (!followUp) return notFound(res, 'Follow-up not found')

  followUp.status = 'completed'
  followUp.completedAt = new Date()
  await followUp.save()

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_COMPLETED,
    leadId: followUp.leadId,
    customerId: followUp.customerId,
    performedBy: req.user._id,
    metadata: { followUpId },
  })

  return success(res, { followUp }, 'Follow-up marked as completed')
})

exports.getFollowUpActivityLog = asyncHandler(async (req, res) => {
  const { employeeId, type, status, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query, 'followUpDate')

  const filter = { ...dateFilter }
  if (employeeId) filter.assignedTo = employeeId
  if (type) filter.modeOfContact = type

  if (status === 'overdue') {
    filter.status = 'pending'
    filter.followUpDate = { ...filter.followUpDate, $lt: new Date() }
  } else if (status) {
    filter.status = status
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [followups, total] = await Promise.all([
    FollowUp.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'customerId', select: 'firstName lastName' })
      .populate({ path: 'assignedTo', select: 'name email role' })
      .sort({ followUpDate: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    FollowUp.countDocuments(filter),
  ])

  const leadIds = [...new Set(followups.map((f) => f.leadId?._id || f.leadId).filter(Boolean))]
  const pendingByLeadId = new Map()

  if (leadIds.length > 0) {
    const pendingList = await FollowUp.find({
      leadId: { $in: leadIds },
      status: 'pending',
    })
      .select('_id leadId followUpDate')
      .sort({ followUpDate: 1 })
      .lean()

    for (const p of pendingList) {
      const key = String(p.leadId)
      if (!pendingByLeadId.has(key)) pendingByLeadId.set(key, [])
      pendingByLeadId.get(key).push(p)
    }
  }

  const activities = followups.map((f) => ({
    _id: f._id,
    leadId: f.leadId?._id || f.leadId,
    projectName: f.leadId?.projectName || '',
    jobId: f.leadId?.jobId || '',
    projectId: f.leadId?.jobId || '',
    clientName: formatClientName(f.customerId),
    followUpDate: f.followUpDate,
    type: f.modeOfContact,
    followedBy: f.assignedTo
      ? {
          _id: f.assignedTo._id,
          name: f.assignedTo.name,
          email: f.assignedTo.email,
          role: f.assignedTo.role,
        }
      : null,
    status: resolveFollowUpStatus(f),
    nextFollowUpDate: findNextFollowUpDate(f, pendingByLeadId),
    notes: f.notes || '',
    priority: f.priority,
    completedAt: f.completedAt,
    createdAt: f.createdAt,
  }))

  return success(res, {
    activities,
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.getAllFollowups = asyncHandler(async (req, res) => {
  const { employeeId, status, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const filter = { ...dateFilter }

  if (status === 'overdue') {
    filter.status = 'pending'
    filter.followUpDate = { $lt: new Date() }
  } else if (status) {
    filter.status = status
  }

  if (employeeId) filter.assignedTo = employeeId

  const [followups, total] = await Promise.all([
    FollowUp.find(filter)
      .populate('leadId', 'projectName')
      .populate('customerId', 'firstName lastName')
      .populate('assignedTo', 'name email')
      .sort({ followUpDate: 1 })
      .skip((page - 1) * limit).limit(Number(limit)).lean(),
    FollowUp.countDocuments(filter)
  ])

  const perEmployee = await FollowUp.aggregate([
    { $group: { _id: '$assignedTo', total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'emp' } },
    { $unwind: '$emp' },
    { $project: { employeeId: '$_id', name: '$emp.name', total: 1, completed: 1 } }
  ])

  return success(res, { followups, total, page: Number(page), limit: Number(limit), perEmployee })
})
