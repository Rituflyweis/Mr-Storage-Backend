const jwt = require('jsonwebtoken')
const { JWT_ACCESS_SECRET } = require('../../config/env')
const chatHandler = require('./chat.handler')
const adminHandler = require('./admin.handler')

const initSocket = (io) => {
  global.io = io

  // ── /chat namespace — public, customers only ──────────────────────────────────
  const chatNS = io.of('/chat')

  chatNS.on('connection', (socket) => {
    console.log('[Socket /chat] Connected:', socket.id)

    chatHandler(socket, chatNS)

    socket.on('disconnect', () => {
      console.log('[Socket /chat] Disconnected:', socket.id)
    })
  })

  // ── /admin namespace — authenticated admin + sales ────────────────────────────
  const adminNS = io.of('/admin')

  // Auth middleware on /admin namespace
  adminNS.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    try {
      const decoded = jwt.verify(token, JWT_ACCESS_SECRET)
      socket.user = decoded
      next()
    } catch (err) {
      next(new Error('Invalid token'))
    }
  })

  adminNS.on('connection', (socket) => {
    console.log(`[Socket /admin] Connected: ${socket.id} | user: ${socket.user._id} | role: ${socket.user.role}`)

    // All authenticated users join their personal room
    socket.join(`user:${socket.user._id}`)

    // Admins also join the admin broadcast room
    if (socket.user.role === 'admin') {
      socket.join('admin_room')
    }

    adminHandler(socket, adminNS)

    socket.on('disconnect', () => {
      console.log('[Socket /admin] Disconnected:', socket.id)
    })
  })
}

module.exports = initSocket
