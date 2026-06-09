// schedulers/followUpScheduler.js
const schedule = require('node-schedule')
const FollowUp = require('../../models/FollowUp')

const scheduleFollowUpReminder = (followUp) => {
  const jobDate = new Date(followUp.followUpDate)
  if (jobDate < new Date()) return  // past date skip

  schedule.scheduleJob(followUp._id.toString(), jobDate, async () => {
    try {
      global.io.of('/admin').to(`user:${followUp.assignedTo.toString()}`).emit('followup:reminder', {
        _id: followUp._id,               // consistent — har event mein _id
        type: 'followup_reminder',       // event type — frontend filter ke liye
        followUpId: followUp._id,        
        leadId: followUp.leadId,
        followUpDate: followUp.followUpDate,
        modeOfContact: followUp.modeOfContact,
        message: 'Follow-up reminder!',
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