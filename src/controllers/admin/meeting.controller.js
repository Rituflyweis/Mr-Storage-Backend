const Meeting = require('../../models/Meeting')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')

exports.getMeetings = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'meetingTime')
  const filter = { status: { $ne: 'completed' }, ...dateFilter }

  const meetings = await Meeting.find(filter)
    .populate('customerId')
    .populate('assignedTo')
    .populate('createdBy')
    .sort({ meetingTime: 1 })
    .lean()

  return success(res, { meetings })
})

exports.createMeeting = asyncHandler(async (req, res) => {
  const { customerId, leadId, title, meetingTime, duration, mode, meetingLink, notes, assignedTo } = req.body

  if (mode === 'online' && !meetingLink) {
    return badRequest(res, 'Meeting link is required for online meetings')
  }

  const meeting = await Meeting.create({
    customerId,
    leadId: leadId || null,
    title,
    createdBy: req.user._id,
    assignedTo,
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
    metadata: { title, meetingTime, mode, assignedTo },
  })

  return created(res, { meeting })
})

exports.editMeeting = asyncHandler(async (req, res) => {
  const { meetingId } = req.params
  const updates = req.body

  const meeting = await Meeting.findById(meetingId)
  if (!meeting) return notFound(res, 'Meeting not found')

  if (updates.mode === 'online' && !updates.meetingLink && !meeting.meetingLink) {
    return badRequest(res, 'Meeting link required for online meetings')
  }

  const ALLOWED = ['title','meetingTime','duration','mode','meetingLink','notes','assignedTo','leadId','status']
  ALLOWED.forEach(k => { if (updates[k] !== undefined) meeting[k] = updates[k] })
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
