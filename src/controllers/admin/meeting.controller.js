const Meeting = require('../../models/Meeting')
const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS, MEETING_STATUSES } = require('../../config/constants')

exports.getMeetings = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const filter = {}

  if (status) {
    if (!MEETING_STATUSES.includes(status)) {
      return badRequest(res, 'Invalid status. Use scheduled, completed, cancelled, or rescheduled')
    }
    filter.status = status
  } else {
    filter.status = { $nin: ['completed', 'cancelled'] }
  }

  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.title = { $regex: escaped, $options: 'i' }
  }

  const meetings = await Meeting.find(filter)
    .populate('customerId')
    .populate('leadId')
    .populate('createdBy')
    .sort({ meetingTime: 1 })
    .lean()

  return success(res, { meetings })
})

exports.getMeetingById = asyncHandler(async (req, res) => {
  const { meetingId } = req.params

  const meeting = await Meeting.findById(meetingId)
    .populate('customerId')
    .populate('leadId')
    .populate('createdBy')
    .lean()

  if (!meeting) return notFound(res, 'Meeting not found')

  return success(res, { meeting })
})

exports.createMeeting = asyncHandler(async (req, res) => {
  const { customerId, leadId, title, meetingTime, duration, mode, meetingLink, notes } = req.body

  if (mode === 'online' && !meetingLink) {
    return badRequest(res, 'Meeting link is required for online meetings')
  }

  const meeting = await Meeting.create({
    customerId,
    leadId: leadId || null,
    title,
    createdBy: req.user._id,
    meetingTime: new Date(meetingTime),
    duration,
    mode,
    meetingLink: meetingLink || '',
    notes: notes || '',
  })

  await auditService.log({
    type: 'meeting',
    action: AUDIT_ACTIONS.MEETING_CREATED,
    leadId: leadId || null,
    customerId,
    performedBy: req.user._id,
    metadata: { title, meetingTime, mode },
  })

  return created(res, { meeting })
})

exports.editMeeting = asyncHandler(async (req, res) => {
  const { meetingId } = req.params
  const updates = req.body

  const meeting = await Meeting.findById(meetingId)
  if (!meeting) return notFound(res, 'Meeting not found')

  const effectiveMode = updates.mode !== undefined ? updates.mode : meeting.mode
  const effectiveLink = updates.meetingLink !== undefined ? updates.meetingLink : meeting.meetingLink
  if (effectiveMode === 'online' && !effectiveLink) {
    return badRequest(res, 'Meeting link required for online meetings')
  }

  if (updates.status !== undefined && !MEETING_STATUSES.includes(updates.status)) {
    return badRequest(res, 'Invalid status. Use scheduled, completed, cancelled, or rescheduled')
  }

  const nextCustomerId = updates.customerId !== undefined ? updates.customerId : meeting.customerId
  const nextLeadId = updates.leadId !== undefined ? updates.leadId : meeting.leadId

  if (updates.customerId !== undefined) {
    const customer = await Customer.findById(updates.customerId).select('_id').lean()
    if (!customer) return notFound(res, 'Customer not found')
  }

  if (nextLeadId) {
    const lead = await Lead.findById(nextLeadId).select('customerId').lean()
    if (!lead) return notFound(res, 'Lead not found')
    if (String(lead.customerId) !== String(nextCustomerId)) {
      return badRequest(res, 'Lead does not belong to this customer')
    }
  }

  const ALLOWED = [
    'title', 'meetingTime', 'duration', 'mode', 'meetingLink', 'notes',
    'leadId', 'customerId', 'status',
  ]
  ALLOWED.forEach((k) => {
    if (updates[k] === undefined) return
    if (k === 'meetingTime') {
      meeting.meetingTime = new Date(updates.meetingTime)
      return
    }
    if (k === 'leadId' && (updates.leadId === null || updates.leadId === '')) {
      meeting.leadId = null
      return
    }
    meeting[k] = updates[k]
  })
  await meeting.save()

  await auditService.log({
    type: 'meeting',
    action: AUDIT_ACTIONS.MEETING_EDITED,
    leadId: meeting.leadId,
    customerId: meeting.customerId,
    performedBy: req.user._id,
    metadata: { meetingId, changes: updates },
  })

  return success(res, { meeting })
})

exports.completeMeeting = asyncHandler(async (req, res) => {
  const { meetingId } = req.params

  const meeting = await Meeting.findById(meetingId)
  if (!meeting) return notFound(res, 'Meeting not found')

  meeting.status = 'completed'
  meeting.completedAt = new Date()
  await meeting.save()

  await auditService.log({
    type: 'meeting',
    action: AUDIT_ACTIONS.MEETING_COMPLETED,
    leadId: meeting.leadId,
    customerId: meeting.customerId,
    performedBy: req.user._id,
    metadata: { meetingId },
  })

  return success(res, { meeting }, 'Meeting marked as completed')
})
