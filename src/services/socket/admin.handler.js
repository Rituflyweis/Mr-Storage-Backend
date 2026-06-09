const Message = require('../../models/Message')
const Lead = require('../../models/Lead')
const chatLifecycle = require('../chat/chatLifecycle.service')

const assertStaffCanAccessLead = async (socket, lead) => {
  const isSales = socket.user.role === 'sales'
  if (isSales && String(lead.assignedSales) !== String(socket.user._id)) {
    socket.emit('error', { message: 'This lead is not assigned to you' })
    return false
  }
  return true
}

const adminHandler = (socket, adminNS) => {

  socket.on('join_lead_chat', async ({ leadId }) => {
    if (!leadId) return
    socket.join(`lead:${leadId}`)
    socket.data.activeLead = leadId

    const status = await chatLifecycle.getChatStatusByLeadId(leadId)
    if (status) socket.emit('chat_status', status)
  })

  socket.on('leave_lead_chat', ({ leadId }) => {
    if (!leadId) return
    socket.leave(`lead:${leadId}`)
  })

  socket.on('end_lead_chat', async ({ leadId }) => {
    if (!leadId) return

    try {
      const lead = await Lead.findById(leadId).lean()
      if (!lead) return
      if (!(await assertStaffCanAccessLead(socket, lead))) return

      await chatLifecycle.endChat(leadId, socket.user._id)
    } catch (err) {
      console.error('[AdminHandler] end_lead_chat error:', err.message)
      socket.emit('error', { message: 'Failed to end chat' })
    }
  })

  socket.on('reopen_lead_chat', async ({ leadId }) => {
    if (!leadId) return

    try {
      const lead = await Lead.findById(leadId).lean()
      if (!lead) return
      if (!(await assertStaffCanAccessLead(socket, lead))) return

      await chatLifecycle.reopenChat(leadId, socket.user._id)
    } catch (err) {
      console.error('[AdminHandler] reopen_lead_chat error:', err.message)
      socket.emit('error', { message: 'Failed to reopen chat' })
    }
  })

  socket.on('sales_message', async ({ leadId, content }) => {
    if (!leadId || !content?.trim()) return

    try {
      const lead = await Lead.findById(leadId).lean()
      if (!lead) return
      if (!(await assertStaffCanAccessLead(socket, lead))) return

      if (lead.isChatEnded) {
        socket.emit('error', { message: 'Chat has ended' })
        return
      }

      const senderType = socket.user.role === 'admin' ? 'admin' : 'sales'

      const msg = await Message.create({
        leadId,
        customerId: lead.customerId,
        senderType,
        senderId: socket.user._id,
        content: content.trim(),
        isRead: false,
      })

      const payload = {
        _id: msg._id,
        senderType,
        senderId: socket.user._id,
        senderName: socket.user.name,
        content: msg.content,
        createdAt: msg.createdAt,
        leadId,
      }

      if (global.io) {
        global.io.of('/chat').to(`lead:${leadId}`).emit('new_message', payload)
      }

      adminNS.to(`lead:${leadId}`).emit('new_message', payload)

      // First staff message cuts off AI; admin can manage manually without assigning sales.
      await chatLifecycle.activateStaffChat(leadId, {
        userId: socket.user._id,
        role: senderType,
        staffName: socket.user.name,
      })

    } catch (err) {
      console.error('[AdminHandler] sales_message error:', err.message)
    }
  })

  socket.on('mark_messages_read', async ({ leadId }) => {
    if (!leadId) return
    try {
      await Message.updateMany(
        { leadId, isRead: false, senderType: 'customer' },
        { $set: { isRead: true } }
      )
    } catch (err) {
      console.error('[AdminHandler] mark_messages_read error:', err.message)
    }
  })

  socket.on('sales_typing_start', async ({ leadId }) => {
    if (!leadId) return
    if (await chatLifecycle.isLeadChatEnded(leadId)) return
    if (global.io) {
      global.io.of('/chat').to(`lead:${leadId}`).emit('sales_typing', { isTyping: true, name: socket.user.name })
    }
  })

  socket.on('sales_typing_stop', async ({ leadId }) => {
    if (!leadId) return
    if (await chatLifecycle.isLeadChatEnded(leadId)) return
    if (global.io) {
      global.io.of('/chat').to(`lead:${leadId}`).emit('sales_typing', { isTyping: false })
    }
  })

  socket.on('join_user_room', () => {
  const userId = socket.user._id.toString()
  socket.join(`user:${userId}`)
  console.log(`User ${userId} joined their room`)
})
}

module.exports = adminHandler
