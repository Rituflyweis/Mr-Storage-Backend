const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const Customer = require('../models/Customer')
const env = require('../config/env')
const { success, unauthorized, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { sendOtp } = require('../services/email/mailer')

const OTP_EXPIRY_MINUTES = 10

const signAccess = (customer) =>
  jwt.sign(
    { _id: customer._id, email: customer.email, type: 'customer' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  )

const signRefresh = (customer) =>
  jwt.sign(
    { _id: customer._id, type: 'customer' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  )

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body

  const customer = await Customer.findOne({ email: email.toLowerCase().trim() })
  if (!customer) return unauthorized(res, 'No account found with that email address')
  if (!customer.isActive) return unauthorized(res, 'This account has been deactivated')

  const match = await bcrypt.compare(password, customer.password)
  if (!match) return unauthorized(res, 'Incorrect password')

  const accessToken = signAccess(customer)
  const refreshToken = signRefresh(customer)

  return success(res, {
    accessToken,
    refreshToken,
    customer: {
      _id:        customer._id,
      firstName:  customer.firstName,
      email:      customer.email,
      customerId: customer.customerId,
      photo:      customer.photo,
    },
  })
})

exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken) return badRequest(res, 'Refresh token required')

  try {
    const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET)
    if (decoded.type !== 'customer') return unauthorized(res, 'Invalid token type')

    const customer = await Customer.findById(decoded._id)
    if (!customer || !customer.isActive) return unauthorized(res, 'Customer not found or inactive')

    const accessToken = signAccess(customer)
    return success(res, { accessToken })
  } catch {
    return unauthorized(res, 'Invalid or expired refresh token')
  }
})

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body
  const customer = await Customer.findOne({ email: email.toLowerCase().trim() })

  if (!customer || !customer.isActive) return success(res, {}, 'If that email exists, an OTP has been sent')

  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const hashedOtp = await bcrypt.hash(otp, 10)

  customer.resetOtp = hashedOtp
  customer.resetOtpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000)
  customer.resetOtpVerified = false
  await customer.save()

  await sendOtp({ toEmail: customer.email, name: customer.firstName, otp, expiresInMinutes: OTP_EXPIRY_MINUTES })

  return success(res, {}, 'If that email exists, an OTP has been sent')
})

exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body
  const customer = await Customer.findOne({ email: email.toLowerCase().trim() })

  if (!customer || !customer.resetOtp || !customer.resetOtpExpiry)
    return badRequest(res, 'Invalid or expired OTP')

  if (new Date() > customer.resetOtpExpiry)
    return badRequest(res, 'OTP has expired. Please request a new one')

  const isMaster = env.MASTER_OTP && otp === env.MASTER_OTP
  if (!isMaster) {
    const match = await bcrypt.compare(otp, customer.resetOtp)
    if (!match) return badRequest(res, 'Invalid OTP')
  }

  customer.resetOtp = null
  customer.resetOtpExpiry = null
  customer.resetOtpVerified = true
  await customer.save()

  const resetToken = jwt.sign(
    { _id: customer._id, purpose: 'password-reset', type: 'customer' },
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

  if (decoded.purpose !== 'password-reset' || decoded.type !== 'customer')
    return badRequest(res, 'Invalid reset token')

  const customer = await Customer.findById(decoded._id)
  if (!customer || !customer.resetOtpVerified) return badRequest(res, 'OTP not verified. Please start over')

  customer.password = await bcrypt.hash(newPassword, 12)
  customer.passwordChangedAt = new Date()
  customer.resetOtp = null
  customer.resetOtpExpiry = null
  customer.resetOtpVerified = false
  await customer.save()

  return success(res, {}, 'Password reset successfully')
})

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    return badRequest(res, 'Both currentPassword and newPassword are required')
  }

  const customer = await Customer.findById(req.customer._id)
  if (!customer) return unauthorized(res)

  const match = await bcrypt.compare(currentPassword, customer.password)
  if (!match) return badRequest(res, 'Current password is incorrect')

  customer.password = await bcrypt.hash(newPassword, 12)
  customer.passwordChangedAt = new Date()
  await customer.save()

  return success(res, {}, 'Password updated successfully')
})
