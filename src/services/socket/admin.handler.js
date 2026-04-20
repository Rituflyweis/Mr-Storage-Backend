const Message = require('../../models/Message')
const Lead = require('../../models/Lead')

const adminHandler = (socket, adminNS) => {

  // ── join_lead_chat — sales/admin joins a lead room to chat ─────────────────
  socket.on('join_lead_chat', ({ leadId }) => {
    if (!leadId) return
    socket.join(`lead:${leadId}`)
    socket.data.activeLead = leadId
  })

  socket.on('leave_lead_chat', ({ leadId }) => {
    if (!leadId) return
    socket.leave(`lead:${leadId}`)
  })

  // ── sales_message — sales employee sends message to customer ───────────────
  socket.on('sales_message', async ({ leadId, content }) => {
    if (!leadId || !content?.trim()) return

    try {
      // Verify this lead is assigned to the connected sales user
      const lead = await Lead.findById(leadId).lean()
      if (!lead) return

      const isSales = socket.user.role === 'sales'
      if (isSales && String(lead.assignedSales) !== String(socket.user._id)) {
        socket.emit('error', { message: 'This lead is not assigned to you' })
        return
      }

      // Save message
      const msg = await Message.create({
        leadId,
        customerId: lead.customerId,
        senderType: 'sales',
        senderId: socket.user._id,
        content: content.trim(),
        isRead: false,
      })

      const payload = {
        _id: msg._id,
        senderType: 'sales',
        senderId: socket.user._id,
        senderName: socket.user.name,
        content: msg.content,
        createdAt: msg.createdAt,
        leadId,
      }

      // Send to customer in /chat namespace
      if (global.io) {
        global.io.of('/chat').to(`lead:${leadId}`).emit('new_message', payload)
      }

      // Broadcast within /admin namespace (other admins monitoring can see it)
      adminNS.to(`lead:${leadId}`).emit('new_message', payload)

    } catch (err) {
      console.error('[AdminHandler] sales_message error:', err.message)
    }
  })

  // ── mark_messages_read ─────────────────────────────────────────────────────
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

  // ── typing indicator from sales ────────────────────────────────────────────
  socket.on('sales_typing_start', ({ leadId }) => {
    if (!leadId) return
    if (global.io) {
      global.io.of('/chat').to(`lead:${leadId}`).emit('sales_typing', { isTyping: true, name: socket.user.name })
    }
  })

  socket.on('sales_typing_stop', ({ leadId }) => {
    if (!leadId) return
    if (global.io) {
      global.io.of('/chat').to(`lead:${leadId}`).emit('sales_typing', { isTyping: false })
    }
  })
}

module.exports = adminHandler
