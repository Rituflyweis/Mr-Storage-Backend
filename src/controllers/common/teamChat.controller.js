const mongoose = require('mongoose')
const User = require('../../models/User')
const TeamMessage = require('../../models/TeamMessage')
const { buildDirectKey } = require('../../models/TeamMessage')
const TeamGroup = require('../../models/TeamGroup')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

// Emits over the /admin socket namespace if the socket server is up — safe no-op otherwise
// (e.g. in tests or if a request happens before sockets finish initializing).
const emitToRoom = (room, event, payload) => {
  if (global.io) global.io.of('/admin').to(room).emit(event, payload)
}
const emitToUser = (userId, event, payload) => {
  if (global.io) global.io.of('/admin').to(`user:${userId}`).emit(event, payload)
}

const directRoom = (userIdA, userIdB) => `team_direct:${buildDirectKey(userIdA, userIdB)}`
const groupRoom = (groupId) => `team_group:${groupId}`

const MAX_ATTACHMENTS = 10
// Attachments arrive as [{ url, name, type }] from the presigned-upload flow (POST /upload/presigned-url
// then a direct S3 PUT) — validate shape here since the schema-level validation would otherwise surface
// as an opaque 500 instead of a clean 400.
const sanitizeAttachments = (attachments) => {
  if (attachments === undefined) return { ok: true, value: [] }
  if (!Array.isArray(attachments)) return { ok: false, error: 'attachments must be an array' }
  if (attachments.length > MAX_ATTACHMENTS) return { ok: false, error: `attachments cannot exceed ${MAX_ATTACHMENTS} files` }
  const cleaned = []
  for (const a of attachments) {
    if (!a || typeof a.url !== 'string' || !a.url.trim()) return { ok: false, error: 'each attachment requires a url' }
    cleaned.push({ url: a.url.trim(), name: (a.name || '').trim(), type: (a.type || '').trim() })
  }
  return { ok: true, value: cleaned }
}

// ── Users ────────────────────────────────────────────────────────────────────

// GET /team-chat/users — list/search staff for starting a direct conversation
exports.getUsers = asyncHandler(async (req, res) => {
  const { search } = req.query
  const filter = { _id: { $ne: req.user._id }, isActive: true }
  if (search?.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { email: { $regex: search.trim(), $options: 'i' } },
    ]
  }
  const users = await User.find(filter).select('name email role department avatar').sort({ name: 1 }).lean()
  return success(res, { users })
})

// ── Conversation listing ─────────────────────────────────────────────────────

// GET /team-chat/conversations — direct + group conversations combined, most recent first
exports.getConversations = asyncHandler(async (req, res) => {
  const myId = new mongoose.Types.ObjectId(req.user._id)

  const [directRows, groups] = await Promise.all([
    TeamMessage.aggregate([
      { $match: { channelType: 'direct', participants: myId } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$directKey',
          lastMessage: { $first: '$content' },
          lastMessageAt: { $first: '$createdAt' },
          lastSenderId: { $first: '$senderId' },
          participants: { $first: '$participants' },
          unreadCount: {
            $sum: { $cond: [{ $and: [{ $ne: ['$senderId', myId] }, { $not: { $in: [myId, '$readBy'] } }] }, 1, 0] },
          },
        },
      },
      { $sort: { lastMessageAt: -1 } },
    ]),
    TeamGroup.find({ members: myId, isActive: true }).select('name avatar members admins').lean(),
  ])

  const otherUserIds = directRows.map((r) => r.participants.find((p) => String(p) !== String(myId))).filter(Boolean)
  const otherUsers = otherUserIds.length
    ? await User.find({ _id: { $in: otherUserIds } }).select('name email role').lean()
    : []
  const userMap = new Map(otherUsers.map((u) => [String(u._id), u]))

  const direct = directRows.map((r) => {
    const otherId = r.participants.find((p) => String(p) !== String(myId))
    const other = userMap.get(String(otherId))
    return {
      type: 'direct',
      userId: otherId,
      name: other?.name || '',
      email: other?.email || '',
      role: other?.role || '',
      lastMessage: r.lastMessage,
      lastMessageAt: r.lastMessageAt,
      unreadCount: r.unreadCount,
    }
  })

  const groupIds = groups.map((g) => g._id)
  const lastGroupMessages = groupIds.length
    ? await TeamMessage.aggregate([
        { $match: { channelType: 'group', groupId: { $in: groupIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$groupId', lastMessage: { $first: '$content' }, lastMessageAt: { $first: '$createdAt' } } },
      ])
    : []
  const lastGroupMsgMap = new Map(lastGroupMessages.map((m) => [String(m._id), m]))

  const groupUnreadCounts = groupIds.length
    ? await TeamMessage.aggregate([
        { $match: { channelType: 'group', groupId: { $in: groupIds }, senderId: { $ne: myId }, readBy: { $ne: myId } } },
        { $group: { _id: '$groupId', count: { $sum: 1 } } },
      ])
    : []
  const groupUnreadMap = new Map(groupUnreadCounts.map((c) => [String(c._id), c.count]))

  const groupList = groups.map((g) => {
    const last = lastGroupMsgMap.get(String(g._id))
    return {
      type: 'group',
      groupId: g._id,
      name: g.name,
      avatar: g.avatar,
      memberCount: g.members.length,
      isAdmin: g.admins.some((a) => String(a) === String(myId)),
      lastMessage: last?.lastMessage || '',
      lastMessageAt: last?.lastMessageAt || null,
      unreadCount: groupUnreadMap.get(String(g._id)) || 0,
    }
  })

  const all = [...direct, ...groupList].sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
  return success(res, { conversations: all })
})

// GET /team-chat/unread-count — total unread across every direct + group conversation
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const myId = req.user._id
  const [directCount, groupCount] = await Promise.all([
    TeamMessage.countDocuments({ channelType: 'direct', participants: myId, senderId: { $ne: myId }, readBy: { $ne: myId } }),
    TeamMessage.countDocuments({ channelType: 'group', senderId: { $ne: myId }, readBy: { $ne: myId }, groupId: { $in: await TeamGroup.find({ members: myId }).distinct('_id') } }),
  ])
  return success(res, { count: directCount + groupCount, direct: directCount, group: groupCount })
})

// ── Direct chat ──────────────────────────────────────────────────────────────

// GET /team-chat/direct/:userId/messages
exports.getDirectMessages = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { page = 1, limit = 30 } = req.query
  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30))

  const otherUser = await User.findById(userId).select('name email role').lean()
  if (!otherUser) return notFound(res, 'User not found')

  const key = buildDirectKey(req.user._id, userId)
  const [messages, total] = await Promise.all([
    TeamMessage.find({ channelType: 'direct', directKey: key })
      .sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
    TeamMessage.countDocuments({ channelType: 'direct', directKey: key }),
  ])

  await TeamMessage.updateMany(
    { channelType: 'direct', directKey: key, senderId: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  )
  emitToUser(userId, 'team_messages_read', { by: req.user._id, channelType: 'direct', channelId: req.user._id })

  return success(res, { otherUser, messages: messages.reverse(), total, page: parsedPage, limit: parsedLimit })
})

// POST /team-chat/direct/:userId/messages
exports.sendDirectMessage = asyncHandler(async (req, res) => {
  const { userId } = req.params
  const { content, attachments } = req.body
  const attachmentCheck = sanitizeAttachments(attachments)
  if (!attachmentCheck.ok) return badRequest(res, attachmentCheck.error)
  if (!content?.trim() && !attachmentCheck.value.length) return badRequest(res, 'content or attachments is required')

  const otherUser = await User.findById(userId).select('_id').lean()
  if (!otherUser) return notFound(res, 'User not found')

  const key = buildDirectKey(req.user._id, userId)
  const message = await TeamMessage.create({
    channelType: 'direct',
    directKey: key,
    participants: [req.user._id, userId],
    senderId: req.user._id,
    senderName: req.user.name || '',
    senderRole: req.user.role || '',
    content: content?.trim() || '',
    attachments: attachmentCheck.value,
    readBy: [req.user._id],
  })

  emitToRoom(directRoom(req.user._id, userId), 'new_team_message', message)
  emitToUser(userId, 'new_team_dm_notice', { fromUserId: req.user._id, fromName: req.user.name, content: message.content })

  return created(res, { message }, 'Message sent')
})

// ── Groups ───────────────────────────────────────────────────────────────────

// POST /team-chat/groups
exports.createGroup = asyncHandler(async (req, res) => {
  const { name, memberIds } = req.body
  if (!name?.trim()) return badRequest(res, 'name is required')
  if (!Array.isArray(memberIds) || !memberIds.length) return badRequest(res, 'memberIds is required')

  const members = [...new Set([...memberIds.map(String), String(req.user._id)])]
  const validUsers = await User.countDocuments({ _id: { $in: members }, isActive: true })
  if (validUsers !== members.length) return badRequest(res, 'One or more memberIds are invalid')

  const group = await TeamGroup.create({
    name: name.trim(),
    members,
    admins: [req.user._id],
    createdBy: req.user._id,
  })

  for (const memberId of members) emitToUser(memberId, 'new_team_group', { group })

  return created(res, { group }, 'Group created')
})

// GET /team-chat/groups/:groupId
exports.getGroupDetail = asyncHandler(async (req, res) => {
  const group = await TeamGroup.findById(req.params.groupId)
    .populate('members', 'name email role')
    .populate('admins', 'name email role')
    .lean()
  if (!group || !group.isActive) return notFound(res, 'Group not found')
  if (!group.members.some((m) => String(m._id) === String(req.user._id))) return forbidden(res, 'Not a member of this group')

  return success(res, { group })
})

// PUT /team-chat/groups/:groupId/members — add/remove in one call
exports.updateGroupMembers = asyncHandler(async (req, res) => {
  const { addMemberIds = [], removeMemberIds = [] } = req.body
  const group = await TeamGroup.findById(req.params.groupId)
  if (!group || !group.isActive) return notFound(res, 'Group not found')
  if (!group.admins.some((a) => String(a) === String(req.user._id))) return forbidden(res, 'Only group admins can manage members')

  if (addMemberIds.length) {
    const validUsers = await User.countDocuments({ _id: { $in: addMemberIds }, isActive: true })
    if (validUsers !== addMemberIds.length) return badRequest(res, 'One or more addMemberIds are invalid')
  }

  const removeSet = new Set(removeMemberIds.map(String))
  group.members = [...new Set([...group.members.map(String), ...addMemberIds.map(String)])].filter((id) => !removeSet.has(id))
  group.admins = group.admins.map(String).filter((id) => !removeSet.has(id))
  if (!group.admins.length && group.members.length) group.admins = [group.members[0]]
  await group.save()

  const updated = await TeamGroup.findById(group._id).populate('members', 'name email role').lean()
  emitToRoom(groupRoom(group._id), 'group_members_updated', { groupId: group._id, members: updated.members })
  for (const memberId of addMemberIds) emitToUser(memberId, 'new_team_group', { group: updated })

  return success(res, { group: updated }, 'Group members updated')
})

// GET /team-chat/groups/:groupId/messages
exports.getGroupMessages = asyncHandler(async (req, res) => {
  const group = await TeamGroup.findById(req.params.groupId).select('members isActive').lean()
  if (!group) return notFound(res, 'Group not found')
  if (!group.members.some((m) => String(m) === String(req.user._id))) return forbidden(res, 'Not a member of this group')

  const { page = 1, limit = 30 } = req.query
  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30))

  const [messages, total] = await Promise.all([
    TeamMessage.find({ channelType: 'group', groupId: group._id })
      .sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
    TeamMessage.countDocuments({ channelType: 'group', groupId: group._id }),
  ])

  await TeamMessage.updateMany(
    { channelType: 'group', groupId: group._id, senderId: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  )
  emitToRoom(groupRoom(group._id), 'team_messages_read', { by: req.user._id, channelType: 'group', channelId: group._id })

  return success(res, { messages: messages.reverse(), total, page: parsedPage, limit: parsedLimit })
})

// POST /team-chat/groups/:groupId/messages
exports.sendGroupMessage = asyncHandler(async (req, res) => {
  const { content, attachments } = req.body
  const attachmentCheck = sanitizeAttachments(attachments)
  if (!attachmentCheck.ok) return badRequest(res, attachmentCheck.error)
  if (!content?.trim() && !attachmentCheck.value.length) return badRequest(res, 'content or attachments is required')

  const group = await TeamGroup.findById(req.params.groupId).select('members isActive').lean()
  if (!group || !group.isActive) return notFound(res, 'Group not found')
  if (!group.members.some((m) => String(m) === String(req.user._id))) return forbidden(res, 'Not a member of this group')

  const message = await TeamMessage.create({
    channelType: 'group',
    groupId: group._id,
    participants: group.members,
    senderId: req.user._id,
    senderName: req.user.name || '',
    senderRole: req.user.role || '',
    content: content?.trim() || '',
    attachments: attachmentCheck.value,
    readBy: [req.user._id],
  })

  emitToRoom(groupRoom(group._id), 'new_team_message', message)
  for (const memberId of group.members) {
    if (String(memberId) !== String(req.user._id)) {
      emitToUser(memberId, 'new_team_group_message_notice', { groupId: group._id, fromName: req.user.name, content: message.content })
    }
  }

  return created(res, { message }, 'Message sent')
})
