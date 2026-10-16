const CustomerDirectMessage = require('../models/CustomerDirectMessage')
const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const notificationService = require('./notification.service')

const directRoom = (customerId) => `customer_direct:${customerId}`

const mapMessage = (doc) => ({
  messageId: doc._id,
  customerId: doc.customerId,
  senderType: doc.senderType,
  senderId: doc.senderId || null,
  senderName: doc.senderName || '',
  content: doc.content,
  isReadByCustomer: doc.isReadByCustomer,
  isReadByStaff: doc.isReadByStaff,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
})

const emitDirectChatEvent = (customerId, event, payload) => {
  if (!global.io) return
  const room = directRoom(customerId)
  global.io.of('/chat').to(room).emit(event, payload)
  global.io.of('/admin').to(room).emit(event, payload)
  global.io.of('/admin').to('admin_room').emit('customer_direct_chat_updated', {
    customerId: String(customerId),
    ...payload,
  })
}

exports.directRoom = directRoom
exports.mapMessage = mapMessage
exports.emitDirectChatEvent = emitDirectChatEvent

exports.listMessages = async (customerId, { page = 1, limit = 50, markReadFor = null } = {}) => {
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const [rows, total] = await Promise.all([
    CustomerDirectMessage.find({ customerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    CustomerDirectMessage.countDocuments({ customerId }),
  ])

  if (markReadFor === 'customer') {
    await CustomerDirectMessage.updateMany(
      { customerId, senderType: { $ne: 'customer' }, isReadByCustomer: false },
      { $set: { isReadByCustomer: true } }
    )
  } else if (markReadFor === 'staff') {
    await CustomerDirectMessage.updateMany(
      { customerId, senderType: 'customer', isReadByStaff: false },
      { $set: { isReadByStaff: true } }
    )
  }

  return {
    messages: rows.reverse().map(mapMessage),
    total,
    page: parsedPage,
    limit: parsedLimit,
  }
}

exports.sendCustomerMessage = async (customer, content) => {
  const message = await CustomerDirectMessage.create({
    customerId: customer._id,
    senderType: 'customer',
    senderName: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || 'Customer',
    content: content.trim(),
    isReadByStaff: false,
    isReadByCustomer: true,
  })

  const payload = mapMessage(message.toObject())
  emitDirectChatEvent(customer._id, 'customer_direct_message', payload)
  await exports.notifyStaffForDirectCustomerMessage(customer._id, payload)
  return payload
}

/** Lead/project tab messages mirrored here so staff Global → Customers inbox lists the thread. */
exports.mirrorCustomerLeadMessageToDirectInbox = async (customer, content, { channel, leadId, skipStaffNotify } = {}) => {
  const channelLabel =
    channel && channel !== 'project' ? `[${String(channel).charAt(0).toUpperCase()}${String(channel).slice(1)}] ` : ''
  const message = await CustomerDirectMessage.create({
    customerId: customer._id,
    senderType: 'customer',
    senderName: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || 'Customer',
    content: `${channelLabel}${content.trim()}`,
    isReadByStaff: false,
    isReadByCustomer: true,
  })

  const payload = mapMessage(message.toObject())
  emitDirectChatEvent(customer._id, 'customer_direct_message', {
    ...payload,
    mirroredFrom: 'lead',
    leadId: leadId ? String(leadId) : null,
    channel: channel || 'project',
  })
  if (!skipStaffNotify) {
    await exports.notifyStaffForDirectCustomerMessage(customer._id, payload, { leadId })
  }
  return payload
}

exports.notifyStaffForDirectCustomerMessage = async (customerId, messagePayload, { leadId } = {}) => {
  const resolvedLeadId =
    leadId ||
    (
      await Lead.findOne({ customerId, isTerminated: { $ne: true } })
        .sort({ updatedAt: -1 })
        .select('_id assignedSales projectName jobId')
        .lean()
    )?._id

  let assignedSales = null
  let projectLabel = ''
  if (resolvedLeadId) {
    const lead = await Lead.findById(resolvedLeadId).select('assignedSales projectName jobId').lean()
    assignedSales = lead?.assignedSales
    projectLabel = lead?.projectName || lead?.jobId || ''
  } else {
    const leads = await Lead.find({ customerId, isTerminated: { $ne: true } })
      .select('assignedSales projectName jobId')
      .lean()
    assignedSales = leads.find((l) => l.assignedSales)?.assignedSales
    projectLabel = leads[0]?.projectName || leads[0]?.jobId || ''
  }

  const preview = String(messagePayload.content || '').slice(0, 200)
  const notificationPayload = {
    title: 'New customer message',
    body: projectLabel ? `${projectLabel}: ${preview}` : preview,
    type: 'chat',
    priority: 'medium',
    leadId: resolvedLeadId || null,
    refId: messagePayload.messageId || messagePayload._id,
    refModel: 'CustomerDirectMessage',
  }

  const salesToNotify = new Set()
  if (assignedSales) salesToNotify.add(String(assignedSales))

  if (!assignedSales) {
    const assigned = await Lead.find({
      customerId,
      isTerminated: { $ne: true },
      assignedSales: { $ne: null },
    })
      .select('assignedSales')
      .lean()
    for (const row of assigned) {
      if (row.assignedSales) salesToNotify.add(String(row.assignedSales))
    }
  }

  if (global.io && salesToNotify.size) {
    for (const salesId of salesToNotify) {
      global.io.of('/admin').to(`user:${salesId}`).emit('customer_direct_chat_updated', {
        customerId: String(customerId),
        ...messagePayload,
      })
    }
  }

  await notificationService.notifyUsers([...salesToNotify], notificationPayload)
  await notificationService.notifyRole('admin', notificationPayload)
}

exports.sendStaffMessage = async (customerId, staffUser, content) => {
  const customer = await Customer.findById(customerId).select('_id firstName lastName').lean()
  if (!customer) return { error: 'Customer not found' }

  const senderType = staffUser.role === 'sales' ? 'sales' : 'admin'
  const message = await CustomerDirectMessage.create({
    customerId,
    senderType,
    senderId: staffUser._id,
    senderName: staffUser.name || '',
    content: content.trim(),
    isReadByCustomer: false,
    isReadByStaff: true,
  })

  const payload = mapMessage(message.toObject())
  emitDirectChatEvent(customerId, 'customer_direct_message', payload)
  return { message: payload }
}

exports.getCustomerDirectSummary = async (customerId) => {
  const unreadForCustomer = await CustomerDirectMessage.countDocuments({
    customerId,
    senderType: { $ne: 'customer' },
    isReadByCustomer: false,
  })
  const last = await CustomerDirectMessage.findOne({ customerId }).sort({ createdAt: -1 }).lean()
  return {
    customerId,
    unreadCount: unreadForCustomer,
    lastMessage: last ? mapMessage(last) : null,
  }
}

exports.listStaffConversations = async ({ search, page = 1, limit = 20, staffRole, staffUserId } = {}) => {
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)

  let customerFilter = {}
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    customerFilter = {
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }, { company: regex }],
    }
  }

  let searchCustomerIds = search?.trim()
    ? await Customer.find(customerFilter).distinct('_id')
    : null

  let assignedCustomerIds = null
  if (staffRole === 'sales' && staffUserId) {
    assignedCustomerIds = await Lead.find({
      assignedSales: staffUserId,
      isTerminated: { $ne: true },
    }).distinct('customerId')
    if (!assignedCustomerIds.length) {
      return { conversations: [], total: 0, page: parsedPage, limit: parsedLimit }
    }
  }

  let filterCustomerIds = null
  if (searchCustomerIds && assignedCustomerIds) {
    const allowed = new Set(assignedCustomerIds.map(String))
    filterCustomerIds = searchCustomerIds.filter((id) => allowed.has(String(id)))
    if (!filterCustomerIds.length) {
      return { conversations: [], total: 0, page: parsedPage, limit: parsedLimit }
    }
  } else if (searchCustomerIds) {
    filterCustomerIds = searchCustomerIds
  } else if (assignedCustomerIds) {
    filterCustomerIds = assignedCustomerIds
  }

  const matchStage = filterCustomerIds
    ? { $match: { customerId: { $in: filterCustomerIds } } }
    : { $match: {} }

  const agg = await CustomerDirectMessage.aggregate([
    matchStage,
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$customerId',
        lastMessage: { $first: '$content' },
        lastMessageAt: { $first: '$createdAt' },
        lastSenderType: { $first: '$senderType' },
        unread: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$senderType', 'customer'] }, { $eq: ['$isReadByStaff', false] }] }, 1, 0],
          },
        },
      },
    },
    { $sort: { lastMessageAt: -1 } },
    {
      $facet: {
        rows: [{ $skip: (parsedPage - 1) * parsedLimit }, { $limit: parsedLimit }],
        total: [{ $count: 'count' }],
      },
    },
  ])

  const rows = agg[0]?.rows || []
  const total = agg[0]?.total[0]?.count || 0
  const ids = rows.map((r) => r._id)
  const customers = ids.length
    ? await Customer.find({ _id: { $in: ids } }).select('firstName lastName email phone company').lean()
    : []
  const customerMap = Object.fromEntries(customers.map((c) => [String(c._id), c]))

  const conversations = rows.map((row) => {
    const c = customerMap[String(row._id)]
    return {
      customerId: row._id,
      customerName: c ? [c.firstName, c.lastName].filter(Boolean).join(' ').trim() : '',
      email: c?.email || '',
      company: c?.company || '',
      unreadCount: row.unread,
      lastMessage: row.lastMessage,
      lastMessageAt: row.lastMessageAt,
      lastSenderType: row.lastSenderType,
    }
  })

  return { conversations, total, page: parsedPage, limit: parsedLimit }
}
