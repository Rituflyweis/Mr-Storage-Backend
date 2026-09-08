// schedulers/followUpScheduler.js
const schedule = require('node-schedule')
const FollowUp = require('../../models/FollowUp')
const Notification = require('../../models/Notification')

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

const assignedToIdOf = (followUp) => {
  const raw = followUp?.assignedTo
  if (!raw) return ''
  if (typeof raw === 'object') return String(raw._id || raw.id || '')
  return String(raw)
}

const leadIdOf = (followUp) => {
  const raw = followUp?.leadId
  if (!raw) return null
  if (typeof raw === 'object') return raw._id || raw.id || raw
  return raw
}

const emitFollowUpReminder = async (followUp) => {
  const assignedToId = assignedToIdOf(followUp)
  if (!assignedToId) {
    console.warn('[followUpScheduler] skip emit: missing assignedTo', followUp?._id)
    return
  }
  if (!global.io) {
    console.warn('[followUpScheduler] skip emit: socket server not ready', followUp?._id)
    return
  }

  const reminderMinutes = Number(followUp.reminderMinutes ?? 30)
  const followUpDate = new Date(followUp.followUpDate)
  const message = `Follow-up is scheduled at ${followUpDate.toLocaleString()} and is due in ${reminderMinutes} minutes.`

  const notification = await Notification.create({
    userId: assignedToId,
    leadId: leadIdOf(followUp),
    title: 'Follow-up reminder',
    body: message,
    type: 'followup',
    priority: followUp.priority === 'high' ? 'high' : 'medium',
    refId: followUp._id,
    refModel: 'FollowUp',
  })

  const payload = {
    _id: followUp._id,
    notificationId: notification._id,
    type: 'followup_reminder',
    followUpId: followUp._id,
    leadId: leadIdOf(followUp),
    assignedTo: assignedToId,
    followUpDate: followUp.followUpDate,
    modeOfContact: followUp.modeOfContact,
    reminderMinutes,
    message,
  }

  const room = `user:${assignedToId}`
  global.io.of('/admin').to(room).emit('followup:reminder', payload)
  console.log(`[followUpScheduler] emitted followup:reminder to ${room} for ${followUp._id}`)
}

const scheduleFollowUpReminder = (followUp) => {
  if (!followUp?._id) return
  if (followUp.status && String(followUp.status).toLowerCase() !== 'pending') return

  const reminderMinutes = Number(followUp.reminderMinutes ?? 30)
  const followUpDate = new Date(followUp.followUpDate)
  if (Number.isNaN(followUpDate.getTime())) return

  const now = Date.now()
  const jobDate = new Date(followUpDate.getTime() - Math.max(0, reminderMinutes) * 60 * 1000)
  const jobName = String(followUp._id)

  const existing = schedule.scheduledJobs[jobName]
  if (existing) existing.cancel()

  const run = () => {
    emitFollowUpReminder(followUp).catch((err) => {
      console.error('FollowUp reminder error:', err)
    })
  }

  // Reminder time already reached. Still emit if the follow-up is not stale,
  // otherwise creating "now / in 10 minutes" with default 30-min reminder
  // silently never fired.
  if (jobDate.getTime() <= now) {
    if (followUpDate.getTime() < now - STALE_AFTER_MS) return
    console.log(`[followUpScheduler] reminder already due for ${jobName}, emitting now`)
    setImmediate(run)
    return
  }

  schedule.scheduleJob(jobName, jobDate, run)
  console.log(`[followUpScheduler] scheduled ${jobName} at ${jobDate.toISOString()}`)
}

const initFollowUpScheduler = async () => {
  const now = new Date()
  const pendingFollowUps = await FollowUp.find({
    status: 'pending',
    followUpDate: { $gte: new Date(now.getTime() - STALE_AFTER_MS) },
  }).lean()

  for (const followUp of pendingFollowUps) {
    scheduleFollowUpReminder(followUp)
  }

  console.log(`${pendingFollowUps.length} follow-up reminders scheduled`)
}

module.exports = { scheduleFollowUpReminder, initFollowUpScheduler, emitFollowUpReminder }
