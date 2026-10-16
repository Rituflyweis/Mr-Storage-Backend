const Lead = require('../models/Lead')
const notificationService = require('./notification.service')
const leadListSocket = require('./leadListSocket.service')

const messagePayload = (doc) => ({
  _id: doc._id,
  senderType: doc.senderType,
  content: doc.content,
  createdAt: doc.createdAt,
  leadId: doc.leadId,
  channel: doc.channel || 'project',
  senderName: doc.senderName || '',
})

/** Real-time + in-app notify assigned sales and admins when a customer posts on a lead thread. */
exports.notifyStaffOfLeadCustomerMessage = async (leadId, messageDoc) => {
  const lead = await Lead.findById(leadId)
    .select('assignedSales customerId projectName jobId')
    .lean()
  if (!lead) return

  const msg = messagePayload(messageDoc)
  const preview = String(msg.content || '').slice(0, 200)
  const title = 'New customer message'
  const body =
    lead.projectName || lead.jobId
      ? `${lead.projectName || lead.jobId}: ${preview}`
      : preview

  const notificationPayload = {
    title,
    body,
    type: 'chat',
    priority: 'medium',
    leadId,
    refId: messageDoc._id,
    refModel: 'Message',
  }

  if (global.io) {
    const adminNs = global.io.of('/admin')
    adminNs.to(`lead:${leadId}`).emit('new_message', msg)
    adminNs.to('admin_room').emit('new_customer_message', { leadId, message: msg })
    if (lead.assignedSales) {
      adminNs.to(`user:${lead.assignedSales}`).emit('new_customer_message', { leadId, message: msg })
    }
  }

  if (lead.assignedSales) {
    await notificationService.notify({
      ...notificationPayload,
      userId: lead.assignedSales,
    })
  }

  await notificationService.notifyRole('admin', notificationPayload)

  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'customer_message' })
}

module.exports = exports
