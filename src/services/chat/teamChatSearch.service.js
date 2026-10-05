const mongoose = require('mongoose')
const TeamMessage = require('../../models/TeamMessage')
const TeamGroup = require('../../models/TeamGroup')
const User = require('../../models/User')
const { buildDirectKey } = require('../../models/TeamMessage')
const { escapeRegex } = require('../../utils/leadPayload')

// WhatsApp-style chat search: free text across messages, or the media "chips" under the box.
const SEARCH_TYPES = ['all', 'photos', 'documents', 'links', 'videos', 'gifs', 'audio', 'polls', 'events']
// Team chat has no polls or events yet — those chips answer with an empty, `supported: false` result.
const UNSUPPORTED_TYPES = ['polls', 'events']
const MEDIA_TYPES = ['photos', 'documents', 'videos', 'gifs', 'audio']

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi

// Attachment `type` is whatever the client sent (usually a MIME type like "image/png"), so a file is
// classified by its type first and falls back to the extension in its name or url.
const extension = (exts) => new RegExp(`\\.(${exts.join('|')})(\\?|#|$)`, 'i')
const byTypeOrExtension = (typeRegex, exts) => ({
  $or: [
    { 'attachments.type': typeRegex },
    { 'attachments.name': extension(exts) },
    { 'attachments.url': extension(exts) },
  ],
})
const MEDIA_CONDITIONS = {
  gifs: byTypeOrExtension(/^(image\/gif|gif)$/i, ['gif']),
  photos: byTypeOrExtension(/^(image\/(?!gif)|image$|photo$)/i, ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'svg']),
  videos: byTypeOrExtension(/^(video\/|video$)/i, ['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'm4v']),
  audio: byTypeOrExtension(/^(audio\/|audio$)/i, ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'amr']),
}
// Anything that is not a gif/photo/video/audio counts as a document (pdf, xlsx, docx, zip, …).
MEDIA_CONDITIONS.documents = { $nor: [MEDIA_CONDITIONS.gifs, MEDIA_CONDITIONS.photos, MEDIA_CONDITIONS.videos, MEDIA_CONDITIONS.audio] }

const KIND_BY_TYPE = { photos: 'photo', documents: 'document', videos: 'video', gifs: 'gif', audio: 'audio' }

// Messages the user may read: their direct chats + groups they belong to (same rules as the
// message list endpoints). Optionally narrowed to one chat.
const buildScope = async (userId, { withUserId, groupId }) => {
  if (withUserId) return { channelType: 'direct', directKey: buildDirectKey(userId, withUserId) }
  if (groupId) {
    const isMember = await TeamGroup.exists({ _id: groupId, members: userId })
    return isMember ? { channelType: 'group', groupId: new mongoose.Types.ObjectId(groupId) } : null
  }
  const groupIds = await TeamGroup.find({ members: userId }).distinct('_id')
  return {
    $or: [
      { channelType: 'direct', participants: new mongoose.Types.ObjectId(userId) },
      { channelType: 'group', groupId: { $in: groupIds } },
    ],
  }
}

const describeConversations = async (messages, userId) => {
  const otherIds = new Set()
  const groupIds = new Set()
  const senderIds = new Set()
  for (const m of messages) {
    senderIds.add(String(m.senderId))
    if (m.channelType === 'group' && m.groupId) groupIds.add(String(m.groupId))
    if (m.channelType === 'direct') {
      const other = (m.participants || []).find((p) => String(p) !== String(userId)) || userId
      otherIds.add(String(other))
    }
  }
  const [users, groups] = await Promise.all([
    User.find({ _id: { $in: [...new Set([...otherIds, ...senderIds])] } }).select('name avatar role').lean(),
    TeamGroup.find({ _id: { $in: [...groupIds] } }).select('name avatar').lean(),
  ])
  const userById = new Map(users.map((u) => [String(u._id), u]))
  const groupById = new Map(groups.map((g) => [String(g._id), g]))

  return (m) => {
    const sender = userById.get(String(m.senderId))
    let conversation
    if (m.channelType === 'group') {
      const g = groupById.get(String(m.groupId))
      conversation = { type: 'group', groupId: m.groupId, name: g?.name || '', avatar: g?.avatar || '' }
    } else {
      const otherId = (m.participants || []).find((p) => String(p) !== String(userId)) || userId
      const other = userById.get(String(otherId))
      conversation = { type: 'direct', userId: otherId, name: other?.name || '', avatar: other?.avatar || '' }
    }
    return {
      messageId: m._id,
      sender: { userId: m.senderId, name: sender?.name || m.senderName || '', isMe: String(m.senderId) === String(userId) },
      conversation,
      sentAt: m.createdAt,
    }
  }
}

// Newest message first; files of one message keep the order they were sent in.
const paginate = (skip, limit) => [
  { $sort: { createdAt: -1, _id: -1, fileIndex: 1 } },
  { $facet: { rows: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'count' }] } },
]

/**
 * @returns {{ error?, code?, result? }}
 */
const searchTeamChat = async (userId, { q = '', type = 'all', userId: withUserId, groupId, page = 1, limit = 20 }) => {
  const text = String(q || '').trim()
  if (!SEARCH_TYPES.includes(type)) return { error: `type must be one of: ${SEARCH_TYPES.join(', ')}`, code: 400 }
  if (type === 'all' && !text) return { error: 'q is required when type is all', code: 400 }
  if (text.length > 100) return { error: 'q must be at most 100 characters', code: 400 }
  for (const [key, value] of [['userId', withUserId], ['groupId', groupId]]) {
    if (value && !mongoose.Types.ObjectId.isValid(value)) return { error: `Invalid ${key}`, code: 400 }
  }
  if (withUserId && groupId) return { error: 'Send either userId or groupId, not both', code: 400 }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1)
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50)
  const skip = (pageNum - 1) * limitNum
  const empty = (extra = {}) => ({ result: { type, q: text, items: [], total: 0, page: pageNum, limit: limitNum, totalPages: 0, supported: true, ...extra } })

  if (UNSUPPORTED_TYPES.includes(type)) return empty({ supported: false })

  const scope = await buildScope(userId, { withUserId, groupId })
  if (!scope) return { error: 'Not a member of this group', code: 403 }
  const textRegex = text ? new RegExp(escapeRegex(text), 'i') : null

  let rows
  let total
  let toItem

  if (MEDIA_TYPES.includes(type)) {
    // One result per file: unwind attachments and keep the ones of this kind (matching q by file name or message text).
    const kindMatch = MEDIA_CONDITIONS[type]
    const textMatch = textRegex ? { $or: [{ 'attachments.name': textRegex }, { content: textRegex }] } : {}
    const [res] = await TeamMessage.aggregate([
      { $match: { ...scope, 'attachments.0': { $exists: true } } },
      { $unwind: { path: '$attachments', includeArrayIndex: 'fileIndex' } },
      { $match: { $and: [kindMatch, textMatch] } },
      ...paginate(skip, limitNum),
    ])
    rows = res.rows
    total = res.total[0]?.count || 0
    toItem = (m, base) => ({
      ...base,
      kind: KIND_BY_TYPE[type],
      file: { url: m.attachments.url, name: m.attachments.name, mimeType: m.attachments.type },
      content: m.content,
    })
  } else if (type === 'links') {
    const contentMatch = textRegex ? { $and: [{ content: /https?:\/\//i }, { content: textRegex }] } : { content: /https?:\/\//i }
    ;[rows, total] = await Promise.all([
      TeamMessage.find({ ...scope, ...contentMatch }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limitNum).lean(),
      TeamMessage.countDocuments({ ...scope, ...contentMatch }),
    ])
    toItem = (m, base) => ({ ...base, kind: 'link', links: [...new Set(m.content.match(URL_REGEX) || [])], content: m.content })
  } else {
    // type = all: messages whose text or attached file names match.
    const match = { ...scope, $and: [{ $or: [{ content: textRegex }, { 'attachments.name': textRegex }] }] }
    ;[rows, total] = await Promise.all([
      TeamMessage.find(match).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limitNum).lean(),
      TeamMessage.countDocuments(match),
    ])
    toItem = (m, base) => ({
      ...base,
      kind: 'message',
      content: m.content,
      attachments: (m.attachments || []).map((a) => ({ url: a.url, name: a.name, mimeType: a.type })),
    })
  }

  if (!rows.length) return empty({ total, totalPages: Math.ceil(total / limitNum) })
  const describe = await describeConversations(rows, userId)
  return {
    result: {
      type,
      q: text,
      items: rows.map((m) => toItem(m, describe(m))),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      supported: true,
    },
  }
}

module.exports = { SEARCH_TYPES, UNSUPPORTED_TYPES, searchTeamChat }
