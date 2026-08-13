// Tracks admin/sales staff presence per lead chat room and broadcasts it to the customer side
// (the /chat namespace), so the Customer Panel can show "Team Online"/"Team Offline" —
// the mirror of customerPresence.service.js, which broadcasts the customer's presence to staff.

/** @type {Map<string, Set<string>>} leadId -> Set(socketId) */
const leadStaffSockets = new Map()

/** @type {Map<string, Set<string>>} socketId -> Set(leadId) */
const socketLeads = new Map()

const normalizeId = (id) => String(id)

const getChatIo = () => global.io?.of('/chat')

const emitStaffStatus = (leadId, isOnline, staff) => {
  const io = getChatIo()
  if (!io) return
  io.to(`lead:${leadId}`).emit('staff_online_status', {
    leadId: normalizeId(leadId),
    isOnline,
    staffName: staff?.name || null,
    staffRole: staff?.role || null,
    lastSeenAt: new Date().toISOString(),
  })
}

const isLeadStaffOnline = (leadId) => (leadStaffSockets.get(normalizeId(leadId))?.size || 0) > 0

const registerJoin = (socket, leadId) => {
  const key = normalizeId(leadId)
  if (!leadStaffSockets.has(key)) leadStaffSockets.set(key, new Set())
  const wasEmpty = leadStaffSockets.get(key).size === 0
  leadStaffSockets.get(key).add(socket.id)

  if (!socketLeads.has(socket.id)) socketLeads.set(socket.id, new Set())
  socketLeads.get(socket.id).add(key)

  if (wasEmpty) emitStaffStatus(key, true, { name: socket.user?.name, role: socket.user?.role })
}

const registerLeave = (socket, leadId) => {
  const key = normalizeId(leadId)
  const set = leadStaffSockets.get(key)
  if (set) {
    set.delete(socket.id)
    if (set.size === 0) {
      leadStaffSockets.delete(key)
      emitStaffStatus(key, false, {})
    }
  }
  socketLeads.get(socket.id)?.delete(key)
}

const unregisterSocket = (socketId) => {
  const leads = socketLeads.get(socketId)
  if (!leads) return
  for (const leadId of leads) {
    const set = leadStaffSockets.get(leadId)
    if (set) {
      set.delete(socketId)
      if (set.size === 0) {
        leadStaffSockets.delete(leadId)
        emitStaffStatus(leadId, false, {})
      }
    }
  }
  socketLeads.delete(socketId)
}

module.exports = { registerJoin, registerLeave, unregisterSocket, isLeadStaffOnline }
