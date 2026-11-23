// src/controllers/sales/meeting.controller.js
const Meeting = require('../../models/Meeting')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS, MEETING_STATUSES } = require('../../config/constants')
const { upsertMeetingEvent, syncMeetingStatus } = require('../../services/calendar/calendarSync.service')
const {
  createPublicZoomMeeting,
  updatePublicZoomMeeting,
  deletePublicZoomMeeting,
} = require('../../services/zoom/zoomMeeting.service')

const zoomFields = async ({ title, meetingTime, duration }) => {
  const zoom = await createPublicZoomMeeting({ title, meetingTime, duration })
  return {
    meetingLink: zoom.joinUrl,
    zoomMeetingId: zoom.meetingId,
    zoomStartUrl: zoom.startUrl,
  }
}

// Sales ki assigned lead IDs
const getSalesLeadIds = async (userId) => {
  return await Lead.find({ assignedSales: userId }).distinct('_id')
}

exports.getMeetings = asyncHandler(async (req, res) => {
  const { status, search, leadId } = req.query
  const ownLeadIds = await getSalesLeadIds(req.user._id)

  const filter = {}

  if (leadId) {
    if (!ownLeadIds.some((id) => String(id) === String(leadId))) {
      return forbidden(res, 'You do not have access to this project')
    }
    filter.leadId = leadId
  } else {
    filter.leadId = { $in: ownLeadIds }
  }

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
  const {
    customerId,
    leadId,
    title,
    meetingTime,
    duration,
    mode,
    meetingLink,
    notes,
    reminderMinutes,
    reminderSms,
    reminderEmail,
  } = req.body

  // Lead sales ko assigned hai?
  if (leadId) {
    const lead = await Lead.findById(leadId).select('assignedSales customerId').lean()
    if (!lead) return notFound(res, 'Lead not found')
    if (String(lead.assignedSales) !== String(req.user._id)) {
      return forbidden(res, 'This lead is not assigned to you')
    }
  }

  let link = String(meetingLink || '').trim()
  let zoomMeetingId = ''
  let zoomStartUrl = ''
  if (mode === 'online' && !link) {
    try {
      const zoom = await zoomFields({ title, meetingTime, duration })
      link = zoom.meetingLink
      zoomMeetingId = zoom.zoomMeetingId
      zoomStartUrl = zoom.zoomStartUrl
    } catch (err) {
      return badRequest(res, err.message)
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
    meetingLink: link,
    zoomMeetingId,
    zoomStartUrl,
    reminderMinutes: Number(reminderMinutes ?? 30),
    reminderSms: reminderSms !== false,
    reminderEmail: reminderEmail !== false,
    notes: notes || '',
  })
  await upsertMeetingEvent(meeting)

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

  const previousSchedule = {
    title: meeting.title,
    meetingTime: new Date(meeting.meetingTime).toISOString(),
    duration: meeting.duration,
  }
  const ALLOWED = ['title', 'meetingTime', 'duration', 'mode', 'meetingLink', 'notes', 'status', 'reminderMinutes', 'reminderSms', 'reminderEmail']
  ALLOWED.forEach((k) => {
    if (updates[k] === undefined) return
    if (k === 'meetingLink') {
      const next = String(updates.meetingLink || '').trim()
      if (next) meeting.meetingLink = next
      return
    }
    meeting[k] = k === 'meetingTime' ? new Date(updates[k]) : updates[k]
  })

  try {
    if (meeting.status === 'cancelled' && meeting.zoomMeetingId) {
      await deletePublicZoomMeeting(meeting.zoomMeetingId)
    } else if (meeting.mode === 'online' && !String(meeting.meetingLink || '').trim()) {
      const zoom = await zoomFields({
        title: meeting.title,
        meetingTime: meeting.meetingTime,
        duration: meeting.duration,
      })
      meeting.meetingLink = zoom.meetingLink
      meeting.zoomMeetingId = zoom.zoomMeetingId
      meeting.zoomStartUrl = zoom.zoomStartUrl
    } else if (meeting.zoomMeetingId && meeting.status !== 'cancelled') {
      const changed = previousSchedule.title !== meeting.title
        || previousSchedule.meetingTime !== new Date(meeting.meetingTime).toISOString()
        || previousSchedule.duration !== meeting.duration
      if (changed) {
        await updatePublicZoomMeeting(meeting.zoomMeetingId, {
          title: meeting.title,
          meetingTime: meeting.meetingTime,
          duration: meeting.duration,
        })
      }
    }
  } catch (err) {
    return badRequest(res, err.message)
  }

  await meeting.save()
  await upsertMeetingEvent(meeting)
  await syncMeetingStatus(meeting)

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
  await syncMeetingStatus(meeting)

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