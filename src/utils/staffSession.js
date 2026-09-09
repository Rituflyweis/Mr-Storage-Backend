const ACCOUNT_DEACTIVATED_MESSAGE =
  'Your account is deactivated. Please email to info@steelbuildingdepot.com'

const kickStaffSession = (userId, message = ACCOUNT_DEACTIVATED_MESSAGE) => {
  const io = global.io
  if (!io || !userId) return
  const room = `user:${String(userId)}`
  const adminNS = io.of('/admin')
  adminNS.to(room).emit('auth:deactivated', { message })
  adminNS.in(room).disconnectSockets(true)
}

module.exports = {
  ACCOUNT_DEACTIVATED_MESSAGE,
  kickStaffSession,
}
