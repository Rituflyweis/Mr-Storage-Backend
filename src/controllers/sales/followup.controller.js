const FollowUp = require('../../models/FollowUp')
const auditService = require('../../services/audit.service')
const { success, created, notFound, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')

const isOverdue = (f) => f.status === 'pending' && new Date(f.followUpDate) < new Date()

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const now = new Date()

  const all = await FollowUp.find({ assignedTo: req.user._id, ...dateFilter }).lean()
  const total = all.length
  const completed = all.filter(f => f.status === 'completed').length
  const overdue = all.filter(isOverdue).length
  const upcoming = all.filter(f => f.status === 'pending' && new Date(f.followUpDate) >= now).length

  return success(res, { total, upcoming, completed, overdue })
})

exports.getUpcoming = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'followUpDate')

  const followups = await FollowUp.find({
    assignedTo: req.user._id,
    status: 'pending',
    followUpDate: { $gte: new Date() },
    ...dateFilter,
  })
    .populate('leadId')
    .populate('customerId')
    .sort({ followUpDate: 1 })
    .lean()

  return success(res, { followups })
})

exports.createFollowUp = asyncHandler(async (req, res) => {
  const { leadId, customerId, followUpDate, notes, priority } = req.body

  const followUp = await FollowUp.create({
    leadId,
    customerId,
    assignedTo: req.user._id, // always assigned to self
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
    metadata: { followUpDate, priority },
  })

  return created(res, { followUp })
})

exports.completeFollowUp = asyncHandler(async (req, res) => {
  const { followUpId } = req.params

  const followUp = await FollowUp.findById(followUpId)
  if (!followUp) return notFound(res, 'Follow-up not found')
  if (String(followUp.assignedTo) !== String(req.user._id)) return forbidden(res, 'Access denied')

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

exports.getKpi = asyncHandler(async (req, res) => {
  return success(res, {
    weeklyCount: 0,
    responseRate: 0,
    conversionRate: 0,
    avgResponseTimeHours: 0,
    note: 'KPI data will be calculated in a future release',
  })
})
