const { processCustomerMessage } = require('./processCustomerMessage')
const chatLifecycle = require('../chat/chatLifecycle.service')
const customerPresence = require('./customerPresence.service')

const chatHandler = (socket, chatNS) => {

  socket.on('join_lead', async ({ leadId, customerId }) => {
    if (!leadId || !customerId) return

    const presence = await customerPresence.registerJoin(socket, { leadId, customerId })
    if (!presence.ok) {
      if (presence.reason === 'customer_mismatch') {
        socket.emit('chat_error', { message: 'Invalid customer for this project' })
      } else if (presence.reason === 'lead_not_found') {
        socket.emit('chat_error', { message: 'Project not found' })
      }
      return
    }

    socket.join(`lead:${leadId}`)
    socket.data.leadId = leadId
    socket.data.customerId = customerId

    const status = await chatLifecycle.getChatStatusByLeadId(leadId)
    if (status) socket.emit('chat_status', status)
  })

  socket.on('leave_lead', async ({ leadId }) => {
    if (!leadId) return
    await customerPresence.leaveLead(socket, { leadId })
    socket.leave(`lead:${leadId}`)
  })

  socket.on('typing_start', async ({ leadId }) => {
    if (!leadId) return
    if (await chatLifecycle.isLeadChatEnded(leadId)) return
    socket.to(`lead:${leadId}`).emit('customer_typing', { isTyping: true })
    if (global.io) {
      global.io.of('/admin').to(`lead:${leadId}`).emit('customer_typing', { isTyping: true })
    }
  })

  socket.on('typing_stop', async ({ leadId }) => {
    if (!leadId) return
    if (await chatLifecycle.isLeadChatEnded(leadId)) return
    socket.to(`lead:${leadId}`).emit('customer_typing', { isTyping: false })
    if (global.io) {
      global.io.of('/admin').to(`lead:${leadId}`).emit('customer_typing', { isTyping: false })
    }
  })

  socket.on('customer_message', async ({ leadId, customerId, content }) => {
    if (!leadId || !customerId || !content?.trim()) return

    try {
      if (await chatLifecycle.isLeadChatEnded(leadId)) {
        chatNS.to(`lead:${leadId}`).emit('chat_error', { message: 'This chat has been closed' })
        return
      }

      await processCustomerMessage({ leadId, customerId, content, chatNS })
    } catch (err) {
      console.error('[ChatHandler] customer_message error:', err.message)
      chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: false })
      chatNS.to(`lead:${leadId}`).emit('chat_error', { message: 'Something went wrong. Please try again.' })
    }
  })
}

module.exports = chatHandler
