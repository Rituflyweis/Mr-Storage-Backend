const jwt = require('jsonwebtoken')
const User = require('../../models/User')
const { JWT_ACCESS_SECRET } = require('../../config/env')
const chatHandler = require('./chat.handler')
const adminHandler = require('./admin.handler')
const aiScriptHandler = require('./aiScript.handler')
const teamChatHandler = require('./teamChat.handler')
const customerPresence = require('./customerPresence.service')
const staffPresence = require('./staffPresence.service')

const initSocket = (io) => {
  global.io = io

  const chatNS = io.of('/chat')

  chatNS.on('connection', (socket) => {
    console.log('[Socket /chat] Connected:', socket.id)

    chatHandler(socket, chatNS)

    socket.on('disconnect', () => {
      customerPresence.unregisterSocket(socket.id).catch((err) => {
        console.error('[Socket /chat] Presence cleanup error:', err.message)
      })
      console.log('[Socket /chat] Disconnected:', socket.id)
    })
  })

  const adminNS = io.of('/admin')

  adminNS.use(async (socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET)
      const user = await User.findById(decoded._id).select('_id email role name isActive isMainAdmin')
      if (!user || !user.isActive) return next(new Error('Account deactivated'))
      socket.user = {
        _id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
        isMainAdmin: user.role === 'admin' ? Boolean(user.isMainAdmin) : false,
      }
      next()
    } catch (err) {
      next(new Error('Invalid token'))
    }
  })

  adminNS.on('connection', (socket) => {
    console.log(`[Socket /admin] Connected: ${socket.id} | user: ${socket.user._id} | role: ${socket.user.role}`)

    socket.join(`user:${String(socket.user._id)}`)

    if (socket.user.role === 'admin') {
      socket.join('admin_room')
    }

    adminHandler(socket, adminNS)
    aiScriptHandler(socket)
    teamChatHandler(socket, adminNS)

    socket.on('disconnect', () => {
      staffPresence.unregisterSocket(socket.id)
      console.log('[Socket /admin] Disconnected:', socket.id)
    })
  })
}

module.exports = initSocket
