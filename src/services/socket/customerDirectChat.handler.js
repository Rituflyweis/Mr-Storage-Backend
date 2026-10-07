const Customer = require('../../models/Customer')
const customerDirectChat = require('../customerDirectChat.service')

const staffRoles = new Set(['admin', 'sales'])

const customerDirectChatHandler = (socket, namespace) => {
  const isAdminNs = namespace.name === '/admin'

  socket.on('join_customer_direct', async ({ customerId } = {}) => {
    try {
      let id = customerId
      if (!isAdminNs) {
        if (!socket.customer?._id) {
          socket.emit('direct_chat_error', { message: 'Customer authentication required' })
          return
        }
        id = socket.customer._id
      } else if (!staffRoles.has(socket.user?.role)) {
        socket.emit('direct_chat_error', { message: 'Not allowed' })
        return
      }

      if (!id) {
        socket.emit('direct_chat_error', { message: 'customerId is required' })
        return
      }

      const customer = await Customer.findById(id).select('_id').lean()
      if (!customer) {
        socket.emit('direct_chat_error', { message: 'Customer not found' })
        return
      }

      socket.join(customerDirectChat.directRoom(id))
      socket.data.directCustomerId = String(id)
      socket.emit('customer_direct_joined', { customerId: String(id) })
    } catch (err) {
      console.error('[DirectChat] join error:', err.message)
      socket.emit('direct_chat_error', { message: 'Failed to join direct chat' })
    }
  })

  socket.on('leave_customer_direct', ({ customerId } = {}) => {
    const id = customerId || socket.data.directCustomerId
    if (!id) return
    socket.leave(customerDirectChat.directRoom(id))
  })

  socket.on('customer_direct_message', async ({ customerId, content } = {}) => {
    try {
      if (!content?.trim()) return

      if (isAdminNs) {
        if (!staffRoles.has(socket.user?.role)) return
        if (!customerId) return
        const result = await customerDirectChat.sendStaffMessage(customerId, socket.user, content)
        if (result.error) socket.emit('direct_chat_error', { message: result.error })
        return
      }

      const id = socket.customer?._id || customerId
      if (!id || String(id) !== String(socket.customer?._id)) {
        socket.emit('direct_chat_error', { message: 'Invalid customer session' })
        return
      }

      const customer = await Customer.findById(id).lean()
      if (!customer) return
      await customerDirectChat.sendCustomerMessage(customer, content)
    } catch (err) {
      console.error('[DirectChat] message error:', err.message)
      socket.emit('direct_chat_error', { message: 'Failed to send message' })
    }
  })

  socket.on('customer_direct_typing', ({ customerId, isTyping } = {}) => {
    const id = isAdminNs ? customerId : socket.customer?._id
    if (!id) return
    const event = isAdminNs ? 'customer_direct_typing' : 'staff_direct_typing'
    socket.to(customerDirectChat.directRoom(id)).emit(event, {
      customerId: String(id),
      isTyping: Boolean(isTyping),
      name: isAdminNs ? socket.user?.name : socket.customer?.email,
    })
  })
}

module.exports = customerDirectChatHandler
