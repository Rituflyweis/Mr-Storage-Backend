const { processCustomerMessage } = require('./processCustomerMessage')

const chatHandler = (socket, chatNS) => {

  socket.on('join_lead', ({ leadId, customerId }) => {
    if (!leadId) return
    socket.join(`lead:${leadId}`)
    socket.data.leadId = leadId
    socket.data.customerId = customerId
  })

  socket.on('typing_start', ({ leadId }) => {
    if (!leadId) return
    socket.to(`lead:${leadId}`).emit('customer_typing', { isTyping: true })
    if (global.io) {
      global.io.of('/admin').to(`lead:${leadId}`).emit('customer_typing', { isTyping: true })
    }
  })

  socket.on('typing_stop', ({ leadId }) => {
    if (!leadId) return
    socket.to(`lead:${leadId}`).emit('customer_typing', { isTyping: false })
    if (global.io) {
      global.io.of('/admin').to(`lead:${leadId}`).emit('customer_typing', { isTyping: false })
    }
  })

  socket.on('customer_message', async ({ leadId, customerId, content }) => {
    if (!leadId || !customerId || !content?.trim()) return

    try {
      await processCustomerMessage({ leadId, customerId, content, chatNS })
    } catch (err) {
      console.error('[ChatHandler] customer_message error:', err.message)
      chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: false })
      chatNS.to(`lead:${leadId}`).emit('chat_error', { message: 'Something went wrong. Please try again.' })
    }
  })
}

module.exports = chatHandler
