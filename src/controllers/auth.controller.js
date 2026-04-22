const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const env = require('../config/env')
const { success, unauthorized, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { sendOtp } = require('../services/email/mailer')

const OTP_EXPIRY_MINUTES = 10

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

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body
  const user = await User.findOne({ email: email.toLowerCase().trim() })

  // Always respond success to prevent email enumeration
  if (!user || !user.isActive) return success(res, {}, 'If that email exists, an OTP has been sent')

  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const hashedOtp = await bcrypt.hash(otp, 10)

  user.resetOtp = hashedOtp
  user.resetOtpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
  user.resetOtpVerified = false
  await user.save()

  await sendOtp({ toEmail: user.email, name: user.name, otp, expiresInMinutes: OTP_EXPIRY_MINUTES })

  return success(res, {}, 'If that email exists, an OTP has been sent')
})

exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body
  const user = await User.findOne({ email: email.toLowerCase().trim() })

  if (!user || !user.resetOtp || !user.resetOtpExpiry)
    return badRequest(res, 'Invalid or expired OTP')

  if (new Date() > user.resetOtpExpiry)
    return badRequest(res, 'OTP has expired. Please request a new one')

  const match = await bcrypt.compare(otp, user.resetOtp)
  if (!match) return badRequest(res, 'Invalid OTP')

  user.resetOtp = null
  user.resetOtpExpiry = null
  user.resetOtpVerified = true
  await user.save()

  const resetToken = jwt.sign(
    { _id: user._id, purpose: 'password-reset' },
    env.JWT_RESET_SECRET,
    { expiresIn: '5m' }
  )

  return success(res, { resetToken }, 'OTP verified successfully')
})

exports.resetPassword = asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body

  let decoded
  try {
    decoded = jwt.verify(resetToken, env.JWT_RESET_SECRET)
  } catch {
    return badRequest(res, 'Invalid or expired reset token')
  }

  if (decoded.purpose !== 'password-reset') return badRequest(res, 'Invalid reset token')

  const user = await User.findById(decoded._id).select('+password')
  if (!user || !user.resetOtpVerified) return badRequest(res, 'OTP not verified. Please start over')

  user.password = await bcrypt.hash(newPassword, 12)
  user.passwordChangedAt = new Date()
  user.resetOtp = null
  user.resetOtpExpiry = null
  user.resetOtpVerified = false
  await user.save()

  return success(res, {}, 'Password reset successfully')
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
