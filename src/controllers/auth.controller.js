const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const env = require('../config/env')
const { success, unauthorized, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')

const signAccess = (user) =>
  jwt.sign({ _id: user._id, email: user.email, role: user.role, name: user.name }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  })

const signRefresh = (user) =>
  jwt.sign({ _id: user._id }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  })

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password')
  if (!user) return unauthorized(res, 'Invalid credentials')
  if (!user.isActive) return unauthorized(res, 'Account is deactivated')

  const match = await bcrypt.compare(password, user.password)
  if (!match) return unauthorized(res, 'Invalid credentials')

  const accessToken = signAccess(user)
  const refreshToken = signRefresh(user)

  return success(res, {
    accessToken,
    refreshToken,
    role: user.role,
    user: { _id: user._id, name: user.name, email: user.email, role: user.role },
  })
})

exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken) return badRequest(res, 'Refresh token required')

  try {
    const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET)
    const user = await User.findById(decoded._id)
    if (!user || !user.isActive) return unauthorized(res, 'User not found or inactive')

    const accessToken = signAccess(user)
    return success(res, { accessToken })
  } catch {
    return unauthorized(res, 'Invalid or expired refresh token')
  }
})

exports.logout = asyncHandler(async (req, res) => {
  // Client-side token deletion only (no Redis blacklist)
  return success(res, {}, 'Logged out successfully')
})

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body

  const user = await User.findById(req.user._id).select('+password')
  if (!user) return unauthorized(res)

  const match = await bcrypt.compare(currentPassword, user.password)
  if (!match) return badRequest(res, 'Current password is incorrect')

  user.password = await bcrypt.hash(newPassword, 12)
  user.passwordChangedAt = new Date()
  await user.save()

  return success(res, {}, 'Password updated successfully')
})
