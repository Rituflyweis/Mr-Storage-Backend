const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const Customer = require('../models/Customer')
const env = require('../config/env')
const { success, unauthorized, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')

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
  if (!customer) return unauthorized(res, 'Invalid credentials')
  if (!customer.isActive) return unauthorized(res, 'Account is deactivated')

  const match = await bcrypt.compare(password, customer.password)
  if (!match) return unauthorized(res, 'Invalid credentials')

  const accessToken = signAccess(customer)
  const refreshToken = signRefresh(customer)

  return success(res, {
    accessToken,
    refreshToken,
    customer: {
      _id: customer._id,
      firstName: customer.firstName,
      email: customer.email,
      customerId: customer.customerId,
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

exports.logout = asyncHandler(async (_req, res) => {
  return success(res, {}, 'Logged out successfully')
})
