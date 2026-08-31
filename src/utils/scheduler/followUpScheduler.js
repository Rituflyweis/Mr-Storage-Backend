// schedulers/followUpScheduler.js
const schedule = require('node-schedule')
const FollowUp = require('../../models/FollowUp')
const Notification = require('../../models/Notification')

const scheduleFollowUpReminder = (followUp) => {
  const reminderMinutes = Number(followUp.reminderMinutes ?? 30)
  const jobDate = new Date(new Date(followUp.followUpDate).getTime() - reminderMinutes * 60 * 1000)
  if (jobDate < new Date()) return  // past date skip

  schedule.scheduleJob(followUp._id.toString(), jobDate, async () => {
    try {
      // Persist first — this is the source of truth. The socket emit below is a
      // best-effort live nudge; if the assigned user isn't connected at this exact
      // instant, they'd previously lose the reminder forever with no record of it.
      const notification = await Notification.create({
        userId: followUp.assignedTo,
        leadId: followUp.leadId,
        title: 'Follow-up reminder',
        body: `Follow-up is scheduled at ${new Date(followUp.followUpDate).toLocaleString()} and is due in ${reminderMinutes} minutes.`,
        type: 'followup',
        priority: followUp.priority === 'high' ? 'high' : 'medium',
        refId: followUp._id,
        refModel: 'FollowUp',
      })

      global.io.of('/admin').to(`user:${followUp.assignedTo.toString()}`).emit('followup:reminder', {
        _id: followUp._id,               // consistent — har event mein _id
        notificationId: notification._id,
        type: 'followup_reminder',       // event type — frontend filter ke liye
        followUpId: followUp._id,
        leadId: followUp.leadId,
        followUpDate: followUp.followUpDate,
        modeOfContact: followUp.modeOfContact,
        reminderMinutes,
        message: `Follow-up is scheduled at ${new Date(followUp.followUpDate).toLocaleString()} and is due in ${reminderMinutes} minutes.`,
      })
    } catch (err) {
      console.error('FollowUp reminder error:', err)
    }
  })
}

const initFollowUpScheduler = async () => {
  const now = new Date()
  const pendingFollowUps = await FollowUp.find({
    status: 'pending',
    followUpDate: { $gte: now },
  }).lean()

  for (const followUp of pendingFollowUps) {
    scheduleFollowUpReminder(followUp)
  }

  console.log(`${pendingFollowUps.length} follow-up reminders scheduled`)
}

module.exports = { scheduleFollowUpReminder, initFollowUpScheduler }