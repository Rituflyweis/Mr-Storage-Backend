// src/controllers/sales/meeting.controller.js
const Meeting = require('../../models/Meeting')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS, MEETING_STATUSES } = require('../../config/constants')

// Sales ki assigned lead IDs
const getSalesLeadIds = async (userId) => {
  return await Lead.find({ assignedSales: userId }).distinct('_id')
}

exports.getMeetings = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const leadIds = await getSalesLeadIds(req.user._id)

  const filter = { leadId: { $in: leadIds } }  // ← sirf apni leads

  if (status) {
    if (!MEETING_STATUSES.includes(status)) {
      return badRequest(res, 'Invalid status')
    }
    filter.status = status
  } else {
    filter.status = { $nin: ['completed', 'cancelled'] }
  }

  if (search?.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.title = { $regex: escaped, $options: 'i' }
  }

  const meetings = await Meeting.find(filter)
    .populate('customerId')
    .populate('leadId')
    .sort({ meetingTime: 1 })
    .lean()

  return success(res, { meetings })
})

exports.createMeeting = asyncHandler(async (req, res) => {
  const { customerId, leadId, title, meetingTime, duration, mode, meetingLink, notes } = req.body

  if (mode === 'online' && !meetingLink) {
    return badRequest(res, 'Meeting link is required for online meetings')
  }

  // Lead sales ko assigned hai?
  if (leadId) {
    const lead = await Lead.findById(leadId).select('assignedSales customerId').lean()
    if (!lead) return notFound(res, 'Lead not found')
    if (String(lead.assignedSales) !== String(req.user._id)) {
      return forbidden(res, 'This lead is not assigned to you')
    }
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

  // Sirf apna banaya meeting edit kar sake
  if (String(meeting.createdBy) !== String(req.user._id)) {
    return forbidden(res, 'You can only edit your own meetings')
  }

  const effectiveMode = updates.mode ?? meeting.mode
  const effectiveLink = updates.meetingLink ?? meeting.meetingLink
  if (effectiveMode === 'online' && !effectiveLink) {
    return badRequest(res, 'Meeting link required for online meetings')
  }

  const ALLOWED = ['title', 'meetingTime', 'duration', 'mode', 'meetingLink', 'notes', 'status']
  ALLOWED.forEach((k) => {
    if (updates[k] === undefined) return
    meeting[k] = k === 'meetingTime' ? new Date(updates[k]) : updates[k]
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

  if (String(meeting.createdBy) !== String(req.user._id)) {
    return forbidden(res, 'You can only complete your own meetings')
  }

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