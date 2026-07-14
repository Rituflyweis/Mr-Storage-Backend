const TeamMessage = require('../../models/TeamMessage')
const User = require('../../models/User')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDirectKey } = require('../../models/TeamMessage')

const DEPARTMENT_LABELS = {
  admin: 'Admin Team',
  sales: 'Sales Team',
  construction: 'Construction Team',
  plant: 'Plant Management',
  account: 'Accounting Team',
}

// GET /communication/channels
exports.getChannels = asyncHandler(async (req, res) => {
  const myId = req.user._id

  const departments = await Promise.all(
    Object.entries(DEPARTMENT_LABELS).map(async ([key, label]) => {
      const unread = await TeamMessage.countDocuments({
        channelType: 'department',
        department: key,
        senderId: { $ne: myId },
        readBy: { $ne: myId },
      })
      const last = await TeamMessage.findOne({ channelType: 'department', department: key }).sort({ createdAt: -1 }).lean()
      return { channelId: key, name: label, unread, lastMessage: last ? { content: last.content, createdAt: last.createdAt, senderName: last.senderName } : null }
    })
  )

  const directMsgs = await TeamMessage.find({ channelType: 'direct', participants: myId })
    .sort({ createdAt: -1 })
    .lean()

  const directByPartner = new Map()
  for (const m of directMsgs) {
    const partnerId = m.participants.map(String).find((p) => p !== String(myId))
    if (!partnerId || directByPartner.has(partnerId)) continue
    directByPartner.set(partnerId, m)
  }

  const partnerIds = [...directByPartner.keys()]
  const partners = partnerIds.length ? await User.find({ _id: { $in: partnerIds } }).select('name role').lean() : []
  const partnerMap = new Map(partners.map((p) => [String(p._id), p]))

  const direct = await Promise.all(partnerIds.map(async (partnerId) => {
    const last = directByPartner.get(partnerId)
    const unread = await TeamMessage.countDocuments({
      channelType: 'direct',
      directKey: buildDirectKey(myId, partnerId),
      senderId: { $ne: myId },
      readBy: { $ne: myId },
    })
    const partner = partnerMap.get(partnerId)
    return {
      channelId: partnerId,
      name: partner?.name || 'Unknown',
      role: partner?.role || '',
      unread,
      lastMessage: { content: last.content, createdAt: last.createdAt, senderName: last.senderName },
    }
  }))

  return success(res, { departments, direct })
})

// GET /communication/channels/:channelType/:channelId/messages
exports.getChannelMessages = asyncHandler(async (req, res) => {
  const { channelType, channelId } = req.params
  const { page = 1, limit = 50 } = req.query
  const myId = req.user._id

  if (!['department', 'direct'].includes(channelType)) return badRequest(res, 'Invalid channel type')

  const filter = channelType === 'department'
    ? { channelType, department: channelId }
    : { channelType, directKey: buildDirectKey(myId, channelId) }

  const [messages, total] = await Promise.all([
    TeamMessage.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean(),
    TeamMessage.countDocuments(filter),
  ])

  await TeamMessage.updateMany(
    { ...filter, senderId: { $ne: myId }, readBy: { $ne: myId } },
    { $addToSet: { readBy: myId } }
  )

  return success(res, { messages: messages.reverse(), total, page: Number(page), limit: Number(limit) })
})

// POST /communication/channels/:channelType/:channelId/messages — REST fallback (primary path is the socket event)
exports.sendChannelMessage = asyncHandler(async (req, res) => {
  const { channelType, channelId } = req.params
  const { content } = req.body
  if (!content?.trim()) return badRequest(res, 'content is required')
  if (!['department', 'direct'].includes(channelType)) return badRequest(res, 'Invalid channel type')

  const myId = req.user._id
  const doc = {
    channelType,
    senderId: myId,
    senderName: req.user.name || '',
    senderRole: req.user.role || '',
    content: content.trim(),
    readBy: [myId],
  }

  if (channelType === 'department') {
    doc.department = channelId
  } else {
    doc.directKey = buildDirectKey(myId, channelId)
    doc.participants = [myId, channelId]
  }

  const message = await TeamMessage.create(doc)

  const ns = global.io?.of('/admin')
  if (ns) {
    const room = channelType === 'department' ? `team_dept:${channelId}` : `team_direct:${doc.directKey}`
    ns.to(room).emit('new_team_message', message)
  }

  return success(res, { message }, 'Message sent')
})
