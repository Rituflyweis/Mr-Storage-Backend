const FollowUp = require('../../models/FollowUp')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const auditService = require('../../services/audit.service')
const followupScriptService = require('../../services/ai/followupScript.service')
const { success, created, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')

const isOverdue = (f) => f.status === 'pending' && new Date(f.followUpDate) < new Date()

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
  const { leadId, customerId, assignedTo, followUpDate, notes, priority } = req.body

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
