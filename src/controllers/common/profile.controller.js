const User = require('../../models/User')
const { success, notFound, badRequest, unauthorized } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const bcrypt = require('bcryptjs')
const { escapeRegex } = require('../../utils/leadPayload')
const { validatePassword } = require('../../utils/passwordPolicy')

// Never sent back to the client: password hash and the password-reset OTP state.
const PRIVATE_FIELDS = '-password -resetOtp -resetOtpExpiry -resetOtpVerified'

// Display name for the read-only "Role" field.
const ROLE_LABELS = {
  admin: 'Admin',
  sales: 'Sales Executive',
  construction: 'Construction Manager',
  plant: 'Plant Manager',
  account: 'Accounts',
}

const NOTIFICATION_SETTING_KEYS = [
  'twoFactorAuth', 'emailNotification', 'smsNotification', 'dashboardNotifications',
  'weeklyEmailReports', 'systemAlerts', 'loginAlertsViaMail',
]

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^\+?[0-9\s\-()]{7,20}$/
// Profile photo: "JPG, PNG or GIF" — uploaded via POST /upload/presigned-url, then the link is saved here.
const AVATAR_EXTENSION = /\.(jpe?g|png|gif)(\?|#|$)/i

const loadProfile = async (userId) => {
  const user = await User.findById(userId).select(PRIVATE_FIELDS).lean()
  return user ? { ...user, roleLabel: ROLE_LABELS[user.role] || user.role } : null
}

// GET /profile — "My Profile" screen basic info
exports.getProfile = asyncHandler(async (req, res) => {
  const user = await loadProfile(req.user._id)
  if (!user) return notFound(res, 'User not found')
  return success(res, { user })
})

// PUT /profile — "Save Changes" on Basic Information. Role cannot be changed from here.
exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, email, phone, avatar } = req.body

  const user = await User.findById(req.user._id)
  if (!user) return notFound(res, 'User not found')

  if (name !== undefined) {
    const trimmed = String(name || '').trim()
    if (!trimmed) return badRequest(res, 'Full name cannot be empty')
    if (trimmed.length > 100) return badRequest(res, 'Full name must be at most 100 characters')
    user.name = trimmed
  }

  if (email !== undefined) {
    const normalized = String(email || '').trim().toLowerCase()
    if (!EMAIL_REGEX.test(normalized)) return badRequest(res, 'Enter a valid email address')
    if (normalized !== user.email) {
      const taken = await User.exists({ _id: { $ne: user._id }, email: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' } })
      if (taken) return badRequest(res, 'This email is already used by another account')
      user.email = normalized
    }
  }

  if (phone !== undefined) {
    const trimmed = String(phone || '').trim()
    if (trimmed && !PHONE_REGEX.test(trimmed)) return badRequest(res, 'Enter a valid phone number')
    user.phone = trimmed
  }

  if (avatar !== undefined) {
    const url = String(avatar || '').trim()
    if (url) {
      let parsed
      try { parsed = new URL(url) } catch { parsed = null }
      if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) return badRequest(res, 'avatar must be a valid http(s) link')
      if (!AVATAR_EXTENSION.test(parsed.pathname)) return badRequest(res, 'Profile photo must be a JPG, PNG or GIF')
    }
    user.avatar = url
  }

  try {
    await user.save()
  } catch (err) {
    // Unique index race: someone took the email between the check and the save.
    if (err?.code === 11000 && err?.keyPattern?.email) return badRequest(res, 'This email is already used by another account')
    throw err
  }

  return success(res, { user: await loadProfile(user._id) }, 'Profile updated')
})

// PUT /profile/password — "Update Password" on Security Settings
exports.updateProfilePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body
  if (!currentPassword || !newPassword) return badRequest(res, 'currentPassword and newPassword are required')
  if (confirmNewPassword !== undefined && confirmNewPassword !== newPassword) {
    return badRequest(res, 'New password and confirm password do not match')
  }
  const passwordError = validatePassword(newPassword)
  if (passwordError) return badRequest(res, passwordError)
  if (newPassword === currentPassword) return badRequest(res, 'New password must be different from the current password')

  const user = await User.findById(req.user._id).select('+password')
  if (!user) return unauthorized(res)

  const match = await bcrypt.compare(currentPassword, user.password)
  if (!match) return badRequest(res, 'Current password is incorrect')

  user.password = await bcrypt.hash(newPassword, 12)
  user.passwordChangedAt = new Date()
  await user.save()

  return success(res, {}, 'Password updated')
})

// PUT /profile/notification-settings — Account Settings toggles (send only the switches that changed)
exports.updateNotificationSettings = asyncHandler(async (req, res) => {
  const updates = NOTIFICATION_SETTING_KEYS.filter((key) => req.body[key] !== undefined)
  if (!updates.length) return badRequest(res, `Send at least one of: ${NOTIFICATION_SETTING_KEYS.join(', ')}`)
  const notBoolean = updates.filter((key) => typeof req.body[key] !== 'boolean')
  if (notBoolean.length) return badRequest(res, `${notBoolean.join(', ')} must be true or false`)

  const user = await User.findById(req.user._id)
  if (!user) return notFound(res, 'User not found')

  for (const key of updates) user.notificationSettings[key] = req.body[key]
  await user.save()

  return success(res, { notificationSettings: user.notificationSettings }, 'Settings updated')
})
