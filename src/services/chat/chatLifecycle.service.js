const Lead = require('../../models/Lead')
const auditService = require('../audit.service')
const leadListSocket = require('../leadListSocket.service')
const { AUDIT_ACTIONS } = require('../../config/constants')

const formatChatStatus = (lead) => {
  const isChatEnded = Boolean(lead?.isChatEnded)
  return {
    leadId: String(lead._id),
    isChatEnded,
    chatEndedAt: lead.chatEndedAt || null,
    chatEndedBy: lead.chatEndedBy || null,
    canCustomerSend: !isChatEnded,
    canStaffSend: !isChatEnded,
  }
}

const getChatStatusByLeadId = async (leadId) => {
  const lead = await Lead.findById(leadId)
    .select('isChatEnded chatEndedAt chatEndedBy')
    .lean()
  if (!lead) return null
  return formatChatStatus(lead)
}

const isLeadChatEnded = async (leadId) => {
  const lead = await Lead.findById(leadId).select('isChatEnded').lean()
  return Boolean(lead?.isChatEnded)
}

const broadcastChatLifecycle = (leadId, status, event) => {
  if (!global.io) return

  const adminNS = global.io.of('/admin')
  const chatNS = global.io.of('/chat')
  const room = `lead:${leadId}`

  adminNS.to(room).emit('chat_status', status)

  if (event === 'ended') {
    adminNS.to(room).emit('chat_ended', status)
    chatNS.to(room).emit('chat_ended', status)
  } else if (event === 'reopened') {
    adminNS.to(room).emit('chat_reopened', status)
    chatNS.to(room).emit('chat_reopened', status)
  }
}

const endChat = async (leadId, userId) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', status: 404 }

  if (!lead.isChatEnded) {
    lead.isChatEnded = true
    lead.chatEndedAt = new Date()
    lead.chatEndedBy = userId
    await lead.save()

    await auditService.log({
      type: 'chat',
      action: AUDIT_ACTIONS.CHAT_ENDED,
      leadId: lead._id,
      customerId: lead.customerId,
      performedBy: userId,
    })
  }

  const status = formatChatStatus(lead)
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'chat_lifecycle' })
  broadcastChatLifecycle(leadId, status, 'ended')
  return { status }
}

const reopenChat = async (leadId, userId) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', status: 404 }

  if (lead.isChatEnded) {
    lead.isChatEnded = false
    lead.chatEndedAt = null
    lead.chatEndedBy = null
    await lead.save()

    await auditService.log({
      type: 'chat',
      action: AUDIT_ACTIONS.CHAT_REOPENED,
      leadId: lead._id,
      customerId: lead.customerId,
      performedBy: userId,
    })
  }

  const status = formatChatStatus(lead)
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'chat_lifecycle' })
  broadcastChatLifecycle(leadId, status, 'reopened')
  return { status }
}

module.exports = {
  formatChatStatus,
  getChatStatusByLeadId,
  isLeadChatEnded,
  endChat,
  reopenChat,
  broadcastChatLifecycle,
}
