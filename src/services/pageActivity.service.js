const User = require('../models/User')
const UserPageActivity = require('../models/UserPageActivity')
const { USER_ROLES } = require('../config/constants')
const { resolveRolePanel } = require('../utils/auditActivityMessage')

const formatPanels = (panels = {}) => {
  const result = {}
  for (const role of USER_ROLES) {
    const visit = panels[role]
    if (visit?.lastVisitedAt) {
      result[role] = {
        lastVisitedAt: visit.lastVisitedAt,
        lastPage: visit.lastPage || null,
      }
    } else {
      result[role] = null
    }
  }
  return result
}

const formatActivityRow = (user, activity) => ({
  userId: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  panel: resolveRolePanel(user.role),
  lastActiveAt: activity?.lastActiveAt ?? null,
  lastPage: activity?.lastPage ?? null,
  panels: formatPanels(activity?.panels),
})

const logPageVisit = async (userId, { panel, page }) => {
  const now = new Date()

  const activity = await UserPageActivity.findOneAndUpdate(
    { userId },
    {
      $set: {
        lastActiveAt: now,
        [`panels.${panel}.lastVisitedAt`]: now,
        [`panels.${panel}.lastPage`]: page,
        lastPage: { panel, page, visitedAt: now },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean()

  return {
    lastActiveAt: activity.lastActiveAt,
    panel,
    page,
  }
}

const getUserPageActivity = async (userId) => {
  const [user, activity] = await Promise.all([
    User.findById(userId).select('name email role isActive').lean(),
    UserPageActivity.findOne({ userId }).lean(),
  ])

  if (!user) return null

  return formatActivityRow(user, activity)
}

const getUsersPageActivity = async (query = {}) => {
  const { role, isActive, search, page = 1, limit = 20 } = query

  const filter = {}
  if (role) filter.role = role
  if (isActive !== undefined) filter.isActive = isActive === 'true'
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    filter.$or = [{ name: regex }, { email: regex }]
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [employees, activities] = await Promise.all([
    User.find(filter).select('name email role isActive').lean(),
    UserPageActivity.find().lean(),
  ])

  const activityMap = new Map(activities.map((a) => [String(a.userId), a]))

  const rows = employees.map((emp) =>
    formatActivityRow(emp, activityMap.get(String(emp._id)))
  )

  rows.sort((a, b) => {
    if (!a.lastActiveAt && !b.lastActiveAt) return a.name.localeCompare(b.name)
    if (!a.lastActiveAt) return 1
    if (!b.lastActiveAt) return -1
    return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
  })

  const total = rows.length
  const items = rows.slice(skip, skip + parsedLimit)

  return {
    items,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
    },
  }
}

module.exports = {
  logPageVisit,
  getUserPageActivity,
  getUsersPageActivity,
}
