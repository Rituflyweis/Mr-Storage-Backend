const jwt = require('jsonwebtoken')
const User = require('../models/User')
const { JWT_ACCESS_SECRET } = require('../config/env')
const { unauthorized } = require('../utils/apiResponse')
const { ACCOUNT_DEACTIVATED_MESSAGE } = require('../utils/staffSession')

const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res, 'No token provided')
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET)
    const user = await User.findById(decoded._id).select('_id email role name isActive isMainAdmin')
    if (!user) return unauthorized(res, 'User not found or inactive')
    if (!user.isActive) return unauthorized(res, ACCOUNT_DEACTIVATED_MESSAGE)

    req.user = {
      _id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      isMainAdmin: user.role === 'admin' ? Boolean(user.isMainAdmin) : false,
    }
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired')
    return unauthorized(res, 'Invalid token')
  }
}

module.exports = verifyToken
