const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const leadListSocket = require('../leadListSocket.service')

/** @type {Map<string, { customerId: string, leadId: string | null }>} */
const socketRegistry = new Map()

/** @type {Map<string, Set<string>>} */
const customerSockets = new Map()

/** @type {Map<string, Set<string>>} */
const leadSockets = new Map()

const normalizeId = (id) => String(id)

const getAdminIo = () => global.io?.of('/admin')

const addToSet = (map, key, socketId) => {
  const k = normalizeId(key)
  if (!map.has(k)) map.set(k, new Set())
  map.get(k).add(socketId)
  return map.get(k).size
}

const removeFromSet = (map, key, socketId) => {
  const k = normalizeId(key)
  const set = map.get(k)
  if (!set) return 0
  set.delete(socketId)
  if (!set.size) map.delete(k)
  return set.size
}

const buildStatusPayload = ({ lead, customer, scope, isOnline }) => ({
  customerId: normalizeId(customer?._id || lead?.customerId),
  leadId: normalizeId(lead?._id),
  isOnline,
  scope,
  lastSeenAt: new Date().toISOString(),
  projectName: lead?.projectName || '',
  jobId: lead?.jobId || '',
  customerIsOnline: Boolean(customer?.isOnline),
  leadIsOnline: Boolean(lead?.isOnline),
})

const emitOnlineStatus = async (lead, customer, scope, isOnline) => {
  const io = getAdminIo()
  if (!io || !lead) return

  const payload = buildStatusPayload({ lead, customer, scope, isOnline })

  io.to('admin_room').emit('customer_online_status', payload)

  if (lead.assignedSales) {
    io.to(`user:${normalizeId(lead.assignedSales)}`).emit('customer_online_status', payload)
  }

  io.to(`lead:${normalizeId(lead._id)}`).emit('customer_online_status', payload)

  await leadListSocket.emitLeadListUpdated(lead._id, {
    trigger: 'customer_online_status',
    notifySales: true,
  })
}

const setCustomerOnline = async (customerId, isOnline) => {
  const now = new Date()
  const update = isOnline
    ? { isOnline: true, onlineAt: now, lastSeenAt: now }
    : { isOnline: false, lastSeenAt: now }

  return Customer.findByIdAndUpdate(customerId, { $set: update }, { new: true })
    .select('isOnline lastSeenAt onlineAt')
    .lean()
}

const setLeadOnline = async (leadId, isOnline) => {
  const now = new Date()
  const update = isOnline
    ? { isOnline: true, onlineAt: now, lastSeenAt: now }
    : { isOnline: false, lastSeenAt: now }

  return Lead.findByIdAndUpdate(leadId, { $set: update }, { new: true })
    .select('isOnline lastSeenAt onlineAt projectName jobId assignedSales customerId')
    .lean()
}

const markLeadOfflineIfNeeded = async (leadId, customerId) => {
  const remaining = leadSockets.get(normalizeId(leadId))?.size || 0
  if (remaining > 0) return

  const lead = await setLeadOnline(leadId, false)
  if (!lead) return

  const customer = await Customer.findById(customerId).select('isOnline lastSeenAt onlineAt').lean()
  await emitOnlineStatus(lead, customer, 'lead', false)
}

const markCustomerOfflineIfNeeded = async (customerId) => {
  const remaining = customerSockets.get(normalizeId(customerId))?.size || 0
  if (remaining > 0) return

  const customer = await setCustomerOnline(customerId, false)
  if (!customer) return

  const lead = await Lead.findOne({ customerId, isOnline: true })
    .select('isOnline projectName jobId assignedSales customerId')
    .lean()

  const fallbackLead = lead || await Lead.findOne({ customerId })
    .sort({ updatedAt: -1 })
    .select('isOnline projectName jobId assignedSales customerId')
    .lean()

  if (fallbackLead) {
    await emitOnlineStatus(fallbackLead, customer, 'customer', false)
  }
}

const registerJoin = async (socket, { leadId, customerId }) => {
  if (!leadId || !customerId) return { ok: false, reason: 'missing_ids' }

  const lead = await Lead.findById(leadId)
    .select('customerId projectName jobId assignedSales isOnline')
    .lean()

  if (!lead) return { ok: false, reason: 'lead_not_found' }
  if (normalizeId(lead.customerId) !== normalizeId(customerId)) {
    return { ok: false, reason: 'customer_mismatch' }
  }

  const socketId = socket.id
  const previous = socketRegistry.get(socketId)

  if (previous?.leadId && normalizeId(previous.leadId) !== normalizeId(leadId)) {
    removeFromSet(leadSockets, previous.leadId, socketId)
    await markLeadOfflineIfNeeded(previous.leadId, previous.customerId)
  }

  const hadCustomerSockets = (customerSockets.get(normalizeId(customerId))?.size || 0) > 0
  const hadLeadSockets = (leadSockets.get(normalizeId(leadId))?.size || 0) > 0

  socketRegistry.set(socketId, {
    customerId: normalizeId(customerId),
    leadId: normalizeId(leadId),
  })
  socket.data.leadId = leadId
  socket.data.customerId = customerId

  addToSet(customerSockets, customerId, socketId)
  addToSet(leadSockets, leadId, socketId)

  let customer = await Customer.findById(customerId).select('isOnline lastSeenAt onlineAt').lean()

  if (!hadCustomerSockets) {
    customer = await setCustomerOnline(customerId, true)
    await emitOnlineStatus(
      { ...lead, isOnline: lead.isOnline },
      customer,
      'customer',
      true
    )
  }

  if (!hadLeadSockets) {
    const updatedLead = await setLeadOnline(leadId, true)
    await emitOnlineStatus(updatedLead, customer, 'lead', true)
  } else {
    await Lead.findByIdAndUpdate(leadId, { $set: { lastSeenAt: new Date() } })
    await Customer.findByIdAndUpdate(customerId, { $set: { lastSeenAt: new Date() } })
  }

  return { ok: true }
}

const leaveLead = async (socket, { leadId }) => {
  if (!leadId) return { ok: false, reason: 'missing_lead_id' }

  const entry = socketRegistry.get(socket.id)
  if (!entry || !entry.leadId || normalizeId(entry.leadId) !== normalizeId(leadId)) {
    return { ok: false, reason: 'not_in_lead' }
  }

  removeFromSet(leadSockets, leadId, socket.id)
  socketRegistry.set(socket.id, { customerId: entry.customerId, leadId: null })
  delete socket.data.leadId

  await markLeadOfflineIfNeeded(leadId, entry.customerId)
  return { ok: true }
}

const unregisterSocket = async (socketId) => {
  const entry = socketRegistry.get(socketId)
  if (!entry) return

  socketRegistry.delete(socketId)

  const { customerId, leadId } = entry

  if (leadId) {
    removeFromSet(leadSockets, leadId, socketId)
    await markLeadOfflineIfNeeded(leadId, customerId)
  }

  removeFromSet(customerSockets, customerId, socketId)
  await markCustomerOfflineIfNeeded(customerId)
}

const resetAllPresenceOnStartup = async () => {
  socketRegistry.clear()
  customerSockets.clear()
  leadSockets.clear()

  const now = new Date()
  await Promise.all([
    Customer.updateMany({ isOnline: true }, { $set: { isOnline: false, lastSeenAt: now } }),
    Lead.updateMany({ isOnline: true }, { $set: { isOnline: false, lastSeenAt: now } }),
  ])
}

module.exports = {
  registerJoin,
  leaveLead,
  unregisterSocket,
  resetAllPresenceOnStartup,
}
