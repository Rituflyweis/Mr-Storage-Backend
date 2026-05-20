const FollowUp = require('../../models/FollowUp')
const AuditLog = require('../../models/AuditLog')
const Lead = require('../../models/Lead')
const AIScriptSession = require('../../models/AIScriptSession')
const aiScriptChat = require('../../services/ai/aiScriptChat.service')
const auditService = require('../../services/audit.service')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
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

exports.getTrend = asyncHandler(async (req, res) => {
  const { range = '7d' } = req.query
  const rangeMap = { '7d': 7, '30d': 30, '3m': 90 }
  const days = rangeMap[range] || 7
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - days)

  const [createdRaw, completedRaw] = await Promise.all([
    FollowUp.find({ assignedTo: req.user._id, createdAt: { $gte: start } }).select('createdAt').lean(),
    FollowUp.find({ assignedTo: req.user._id, status: 'completed', completedAt: { $gte: start } }).select('completedAt').lean(),
  ])

  const dateMap = {}
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    dateMap[key] = { date: key, created: 0, completed: 0 }
  }

  for (const f of createdRaw) {
    const key = new Date(f.createdAt).toISOString().slice(0, 10)
    if (dateMap[key]) dateMap[key].created++
  }
  for (const f of completedRaw) {
    const key = new Date(f.completedAt).toISOString().slice(0, 10)
    if (dateMap[key]) dateMap[key].completed++
  }

  return success(res, { data: Object.values(dateMap) })
})

exports.getResponseRate = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const ownLeadIds = await Lead.find({ assignedSales: req.user._id }).distinct('_id')

  const activities = await AuditLog.find({
    type: 'activity',
    leadId: { $in: ownLeadIds },
    ...dateFilter,
  }).lean()

  const platforms = ['call', 'email', 'meeting', 'note']
  const breakdown = platforms.map(platform => {
    const entries = activities.filter(a => a.metadata?.activityType === platform)
    const total = entries.length
    const responded = entries.filter(a => a.metadata?.outcome && a.metadata.outcome !== 'no_response').length
    const rate = total > 0 ? Math.round((responded / total) * 100) : 0
    return { platform, total, responded, rate }
  })

  return success(res, { breakdown })
})

exports.createFollowUp = asyncHandler(async (req, res) => {
  const { leadId, followUpDate, modeOfContact, notes, priority } = req.body
  const lead = await Lead.findById(leadId).select('customerId').lean()
  if (!lead) return notFound(res, 'Lead not found')
  const customerId = lead.customerId

  const followUp = await FollowUp.create({
    leadId,
    customerId,
    assignedTo: req.user._id,
    createdBy: req.user._id,
    followUpDate: new Date(followUpDate),
    modeOfContact: modeOfContact || 'call',
    notes: notes || '',
    priority: priority || 'medium',
  })

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_CREATED,
    leadId,
    customerId,
    performedBy: req.user._id,
    metadata: { followUpDate, priority, modeOfContact },
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

exports.getCommunicationTimeline = asyncHandler(async (req, res) => {
  const { leadId, activityType, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const ownLeadIds = await Lead.find({ assignedSales: req.user._id }).distinct('_id')

  const filter = { type: 'activity', leadId: { $in: ownLeadIds }, ...dateFilter }
  if (leadId) filter.leadId = leadId
  if (activityType) filter['metadata.activityType'] = activityType

  const skip = (parsedPage - 1) * parsedLimit
  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .populate({ path: 'leadId', select: 'projectName' })
      .populate({ path: 'customerId', select: 'firstName' })
      .populate({ path: 'performedBy', select: 'name' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    AuditLog.countDocuments(filter),
  ])

  return success(res, { entries, total })
})

exports.getAIScriptSessions = asyncHandler(async (req, res) => {
  const sessions = await AIScriptSession.find({ salesEmployeeId: req.user._id })
    .populate({ path: 'leadId', select: 'projectName' })
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { sessions })
})

exports.postAIScript = asyncHandler(async (req, res) => {
  const { messages, leadId } = req.body

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return badRequest(res, 'messages array is required')
  }

  const { reply, sessionId } = await aiScriptChat.runOneShot({
    userId: req.user._id,
    leadId: leadId || null,
    messages,
  })

  return success(res, { reply, sessionId })
})

exports.getMyQuotations = asyncHandler(async (req, res) => {
  const Quotation = require('../../models/Quotation')
  const { status, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const filter = { createdBy: req.user._id, ...dateFilter }
  if (status) filter.status = status

  const skip = (parsedPage - 1) * parsedLimit
  const [quotations, total] = await Promise.all([
    Quotation.find(filter)
      .populate({ path: 'leadId', select: 'projectName' })
      .populate({ path: 'customerId', select: 'firstName email' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Quotation.countDocuments(filter),
  ])

  const result = quotations.map(q => ({
    _id: q._id,
    quoteNumber: q.quoteNumber || '',
    versionNumber: q.versionNumber || 1,
    status: q.status,
    finalPrice: q.finalPrice || 0,
    leadId: q.leadId ? { _id: q.leadId._id, projectName: q.leadId.projectName } : null,
    customerId: q.customerId ? { _id: q.customerId._id, firstName: q.customerId.firstName, email: q.customerId.email } : null,
    createdAt: q.createdAt,
    sentAt: q.sentAt || null,
  }))

  return success(res, { quotations: result, total, page: parsedPage, limit: parsedLimit })
})
