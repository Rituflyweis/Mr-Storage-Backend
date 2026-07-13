const ChatMessage = require('../../models/ChatMessage')
const User = require('../../models/User')
const asyncHandler = require('../../utils/asyncHandler')
const { success, created } = require('../../utils/apiResponse')

const DEPARTMENT_CHANNELS = [
  { name: 'Project Team',      key: 'project_team' },
  { name: 'Finance Team',      key: 'finance_team' },
  { name: 'Construction Team', key: 'construction_team' },
  { name: 'Plant Team',        key: 'plant_team' },
  { name: 'Sales Team',        key: 'sales_team' },
]

exports.getDepartmentChannels = asyncHandler(async (req, res) => {
  const channels = await Promise.all(
    DEPARTMENT_CHANNELS.map(async (ch) => {
      const unreadCount = await ChatMessage.countDocuments({
        channelType: 'department',
        channelName: ch.key,
        isRead: false,
        senderId: { $ne: req.user._id },
      })
      const lastMsg = await ChatMessage.findOne({ channelType: 'department', channelName: ch.key })
        .sort({ createdAt: -1 }).lean()
      return { ...ch, unreadCount, lastMessage: lastMsg?.content || null, lastMessageAt: lastMsg?.createdAt || null }
    })
  )
  return success(res, { channels })
})

exports.getChannelMessages = asyncHandler(async (req, res) => {
  const { channelKey } = req.params
  const { page = 1, limit = 50 } = req.query

  const messages = await ChatMessage.find({ channelType: 'department', channelName: channelKey })
    .populate({ path: 'senderId', select: 'name role' })
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit))
    .lean()

  await ChatMessage.updateMany(
    { channelType: 'department', channelName: channelKey, isRead: false, senderId: { $ne: req.user._id } },
    { isRead: true, readAt: new Date() }
  )

  return success(res, { messages: messages.reverse(), total: messages.length })
})

exports.sendChannelMessage = asyncHandler(async (req, res) => {
  const { channelKey } = req.params
  const { content } = req.body

  const msg = await ChatMessage.create({
    channelType: 'department',
    channelName: channelKey,
    senderId: req.user._id,
    content,
  })

  await msg.populate({ path: 'senderId', select: 'name role' })
  return created(res, { message: msg })
})

exports.getDirectConversations = asyncHandler(async (req, res) => {
  const userId = req.user._id

  const conversations = await ChatMessage.aggregate([
    {
      $match: {
        channelType: 'direct',
        $or: [{ senderId: userId }, { recipientId: userId }],
      },
    },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ['$senderId', userId] },
            '$recipientId',
            '$senderId',
          ],
        },
        lastMessage: { $last: '$content' },
        lastAt:      { $last: '$createdAt' },
        unread: {
          $sum: {
            $cond: [{ $and: [{ $eq: ['$isRead', false] }, { $eq: ['$recipientId', userId] }] }, 1, 0],
          },
        },
      },
    },
    { $sort: { lastAt: -1 } },
    { $limit: 50 },
  ])

  const users = await User.find({ _id: { $in: conversations.map(c => c._id) } })
    .select('name email role').lean()

  const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]))

  const result = conversations.map(c => ({
    user: userMap[c._id.toString()],
    lastMessage: c.lastMessage,
    lastAt: c.lastAt,
    unread: c.unread,
  }))

  return success(res, { conversations: result })
})

exports.getDirectMessages = asyncHandler(async (req, res) => {
  const myId = req.user._id
  const { userId } = req.params
  const { page = 1, limit = 50 } = req.query

  const messages = await ChatMessage.find({
    channelType: 'direct',
    $or: [
      { senderId: myId, recipientId: userId },
      { senderId: userId, recipientId: myId },
    ],
  })
    .populate({ path: 'senderId', select: 'name role' })
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit))
    .lean()

  await ChatMessage.updateMany(
    { channelType: 'direct', senderId: userId, recipientId: myId, isRead: false },
    { isRead: true, readAt: new Date() }
  )

  return success(res, { messages: messages.reverse() })
})

exports.sendDirectMessage = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { content } = req.body

  const msg = await ChatMessage.create({
    channelType: 'direct',
    senderId: req.user._id,
    recipientId: userId,
    content,
  })

  await msg.populate({ path: 'senderId', select: 'name role' })
  return created(res, { message: msg })
})

exports.getUsersForDM = asyncHandler(async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user._id }, isActive: true })
    .select('name email role department')
    .sort({ name: 1 })
    .lean()
  return success(res, { users })
})
