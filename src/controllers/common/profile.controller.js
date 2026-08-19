const User = require('../../models/User')
const { success, notFound, badRequest, unauthorized } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const bcrypt = require('bcryptjs')

// GET /profile — "My Profile" screen basic info
exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password').lean()
  if (!user) return notFound(res, 'User not found')
  return success(res, { user })
})

// PUT /profile — "Save Changes" on Basic Information
exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, avatar } = req.body

  const user = await User.findById(req.user._id)
  if (!user) return notFound(res, 'User not found')

  if (name !== undefined) user.name = name
  if (phone !== undefined) user.phone = phone
  if (avatar !== undefined) user.avatar = avatar
  await user.save()

  return success(res, { user }, 'Profile updated')
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
