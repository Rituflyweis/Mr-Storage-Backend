const CalendarEvent = require('../../models/CalendarEvent')
const FollowUp = require('../../models/FollowUp')
const Meeting = require('../../models/Meeting')
const { success, badRequest, forbidden, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getEvents = asyncHandler(async (req, res) => {
  const { startDate, endDate, userId, status, kind } = req.query
  const filter = {}

  const targetUserId = userId || req.user._id
  if (req.user.role === 'sales' && String(targetUserId) !== String(req.user._id)) {
    return forbidden(res, 'Sales can view only their own calendar')
  }
  filter.userId = targetUserId

  if (status) filter.status = status
  if (kind) filter.kind = kind

  if (startDate || endDate) {
    filter.startsAt = {}
    if (startDate) filter.startsAt.$gte = new Date(startDate)
    if (endDate) filter.startsAt.$lte = new Date(endDate)
  }

  const events = await CalendarEvent.find(filter).sort({ startsAt: 1 }).lean()
  return success(res, { events })
})

exports.updateReminder = asyncHandler(async (req, res) => {
  const { eventId } = req.params
  const { reminderMinutes, reminderSms, reminderEmail } = req.body
  if (reminderMinutes === undefined && reminderSms === undefined && reminderEmail === undefined) {
    return badRequest(res, 'At least one reminder field is required')
  }

  const event = await CalendarEvent.findById(eventId)
  if (!event) return notFound(res, 'Calendar event not found')
  if (req.user.role === 'sales' && String(event.userId) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }

  if (reminderMinutes !== undefined) event.reminderMinutes = Number(reminderMinutes)
  if (reminderSms !== undefined) event.reminderSms = Boolean(reminderSms)
  if (reminderEmail !== undefined) event.reminderEmail = Boolean(reminderEmail)
  await event.save()

  if (event.sourceModel === 'FollowUp') {
    const updates = {}
    if (reminderMinutes !== undefined) updates.reminderMinutes = Number(reminderMinutes)
    if (reminderSms !== undefined) updates.sendSms = Boolean(reminderSms)
    if (reminderEmail !== undefined) updates.sendEmail = Boolean(reminderEmail)
    if (Object.keys(updates).length) {
      await FollowUp.updateOne({ _id: event.sourceId }, { $set: updates })
    }
  }

  if (event.sourceModel === 'Meeting') {
    const updates = {}
    if (reminderMinutes !== undefined) updates.reminderMinutes = Number(reminderMinutes)
    if (reminderSms !== undefined) updates.reminderSms = Boolean(reminderSms)
    if (reminderEmail !== undefined) updates.reminderEmail = Boolean(reminderEmail)
    if (Object.keys(updates).length) {
      await Meeting.updateOne({ _id: event.sourceId }, { $set: updates })
    }
  }

  return success(res, { event }, 'Calendar reminder updated')
})
