const User = require('../../models/User')
const { success, notFound, badRequest, unauthorized } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const bcrypt = require('bcryptjs')
const {
  shapeStaffProfile,
  parseOptionalTrimmedString,
} = require('../../utils/profileResponse.util')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')

const normalizeEmail = (email) => String(email || '').toLowerCase().trim()

const PROFILE_UPDATE_FIELDS = ['name', 'email', 'phone', 'mobile', 'avatar']

// GET /api/profile — admin, sales, plant, construction, account
exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password').lean()
  if (!user) return notFound(res, 'User not found')
  const profile = shapeStaffProfile(user)
  return success(res, { profile, user: profile })
})

// PUT /api/profile — name, email, phone, mobile (optional), avatar
exports.updateProfile = asyncHandler(async (req, res) => {
  const hasUpdate = PROFILE_UPDATE_FIELDS.some((key) => req.body[key] !== undefined)
  if (!hasUpdate) {
    return badRequest(res, 'No updatable fields provided — send name, email, phone, mobile, or avatar')
  }

  const { name, email, phone, mobile, avatar } = req.body

  const user = await User.findById(req.user._id)
  if (!user) return notFound(res, 'User not found')

  if (email !== undefined) {
    const normalized = normalizeEmail(email)
    if (!normalized) return badRequest(res, 'Invalid email')
    const taken = await User.findOne({ email: normalized, _id: { $ne: user._id } })
    if (taken) return badRequest(res, 'Email is already in use')
    user.email = normalized
  }

  const nextName = parseOptionalTrimmedString(name)
  if (name !== undefined) {
    if (!nextName) return badRequest(res, 'Name cannot be empty')
    user.name = nextName
  }

  if (phone !== undefined) user.phone = parseOptionalTrimmedString(phone)
  if (mobile !== undefined) user.mobile = parseOptionalTrimmedString(mobile)
  if (avatar !== undefined) user.avatar = avatar

  await user.save()

  req.auditLogged = true
  await auditService.logFromRequest(req, {
    type: 'user',
    action: AUDIT_ACTIONS.AUTH_PROFILE_UPDATED,
    entityType: 'user',
    entityId: user._id,
    metadata: {
      fields: PROFILE_UPDATE_FIELDS.filter((k) => req.body[k] !== undefined),
    },
  })

  const profile = shapeStaffProfile(user.toObject())
  return success(res, { profile, user: profile }, 'Profile updated successfully')
})

// PUT /profile/password — "Update Password" on Security Settings
exports.updateProfilePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return badRequest(res, 'currentPassword and newPassword are required')

  const user = await User.findById(req.user._id).select('+password')
  if (!user) return unauthorized(res)

  const match = await bcrypt.compare(currentPassword, user.password)
  if (!match) return badRequest(res, 'Current password is incorrect')

  user.password = await bcrypt.hash(newPassword, 12)
  user.passwordChangedAt = new Date()
  await user.save()

  req.auditLogged = true
  await auditService.logFromRequest(req, {
    type: 'auth',
    action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
    metadata: { source: 'profile.password' },
  })

  return success(res, {}, 'Password updated')
})

// PUT /profile/notification-settings — Account Settings toggles
exports.updateNotificationSettings = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
  if (!user) return notFound(res, 'User not found')

  const allowedKeys = [
    'twoFactorAuth', 'emailNotification', 'smsNotification', 'dashboardNotifications',
    'weeklyEmailReports', 'systemAlerts', 'loginAlertsViaMail',
  ]
  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) user.notificationSettings[key] = !!req.body[key]
  }
  await user.save()

  return success(res, { notificationSettings: user.notificationSettings }, 'Settings updated')
})
