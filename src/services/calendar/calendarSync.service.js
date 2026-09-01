const CalendarEvent = require('../../models/CalendarEvent')

const upsertFollowUpEvent = async (followUp) => {
  if (!followUp?.assignedTo || !followUp?._id) return null
  const startsAt = new Date(followUp.followUpDate)
  const reminderMinutes = Number(followUp.reminderMinutes ?? 30)

  return CalendarEvent.findOneAndUpdate(
    {
      sourceModel: 'FollowUp',
      sourceId: followUp._id,
      userId: followUp.assignedTo,
    },
    {
      $set: {
        userId: followUp.assignedTo,
        leadId: followUp.leadId || null,
        customerId: followUp.customerId || null,
        title: `Follow-up (${followUp.modeOfContact || 'call'})`,
        description: followUp.notes || '',
        kind: 'followup',
        sourceModel: 'FollowUp',
        sourceId: followUp._id,
        startsAt,
        endsAt: null,
        reminderMinutes,
        reminderSms: followUp.sendSms !== false,
        reminderEmail: followUp.sendEmail !== false,
        status: followUp.status === 'completed' ? 'completed' : 'scheduled',
        metadata: {
          priority: followUp.priority || 'medium',
          modeOfContact: followUp.modeOfContact || 'call',
          source: followUp.source || 'manual',
          relatedInvoiceId: followUp.relatedInvoiceId || null,
        },
      },
    },
    { upsert: true, new: true }
  )
}

const upsertMeetingEvent = async (meeting) => {
  if (!meeting?.createdBy || !meeting?._id) return null
  const startsAt = new Date(meeting.meetingTime)
  const durationMinutes = Number(meeting.duration || 0)
  const endsAt = durationMinutes > 0 ? new Date(startsAt.getTime() + durationMinutes * 60 * 1000) : null
  const reminderMinutes = Number(meeting.reminderMinutes ?? 30)

  return CalendarEvent.findOneAndUpdate(
    {
      sourceModel: 'Meeting',
      sourceId: meeting._id,
      userId: meeting.createdBy,
    },
    {
      $set: {
        userId: meeting.createdBy,
        leadId: meeting.leadId || null,
        customerId: meeting.customerId || null,
        title: meeting.title || 'Meeting',
        description: meeting.notes || '',
        kind: 'meeting',
        sourceModel: 'Meeting',
        sourceId: meeting._id,
        startsAt,
        endsAt,
        reminderMinutes,
        reminderSms: meeting.reminderSms !== false,
        reminderEmail: meeting.reminderEmail !== false,
        status: meeting.status === 'completed' ? 'completed' : meeting.status === 'cancelled' ? 'cancelled' : 'scheduled',
        metadata: {
          mode: meeting.mode || 'online',
          meetingLink: meeting.meetingLink || '',
        },
      },
    },
    { upsert: true, new: true }
  )
}

const markFollowUpCompleted = async (followUp) => {
  if (!followUp?._id || !followUp?.assignedTo) return
  await CalendarEvent.updateOne(
    { sourceModel: 'FollowUp', sourceId: followUp._id, userId: followUp.assignedTo },
    { $set: { status: 'completed' } }
  )
}

const syncMeetingStatus = async (meeting) => {
  if (!meeting?._id || !meeting?.createdBy) return
  const status = meeting.status === 'completed'
    ? 'completed'
    : meeting.status === 'cancelled'
      ? 'cancelled'
      : 'scheduled'
  await CalendarEvent.updateOne(
    { sourceModel: 'Meeting', sourceId: meeting._id, userId: meeting.createdBy },
    { $set: { status } }
  )
}

module.exports = {
  upsertFollowUpEvent,
  upsertMeetingEvent,
  markFollowUpCompleted,
  syncMeetingStatus,
}
