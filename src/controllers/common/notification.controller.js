const Notification = require('../../models/Notification')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id
  const { type, priority, read, page = 1, limit = 20 } = req.query
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100)

  const filter = { userId }
  if (type)     filter.type     = type
  if (priority) filter.priority = priority
  if (read !== undefined) filter.isRead = read === 'true'

  const now = new Date()
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)

  const skip = (parsedPage - 1) * parsedLimit
  const [notifications, total, unread, highPriority, today] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId, isRead: false }),
    Notification.countDocuments({ userId, priority: 'high', isRead: false }),
    Notification.countDocuments({ userId, createdAt: { $gte: dayStart } }),
  ])

  return success(res, {
    notifications,
    total,
    stats: { total: await Notification.countDocuments({ userId }), unread, highPriority, today },
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.markRead = asyncHandler(async (req, res) => {
  const { id } = req.params
  const n = await Notification.findOne({ _id: id, userId: req.user._id })
  if (!n) return notFound(res, 'Notification not found')

  n.isRead = true
  await n.save()

  return success(res, { notification: n })
})

exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, isRead: false }, { $set: { isRead: true } })
  return success(res, null, 'All notifications marked as read')
})

exports.deleteNotification = asyncHandler(async (req, res) => {
  const { id } = req.params
  const n = await Notification.findOneAndDelete({ _id: id, userId: req.user._id })
  if (!n) return notFound(res, 'Notification not found')
  return success(res, null, 'Notification deleted')
})
