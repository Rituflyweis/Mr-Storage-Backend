const jwt = require('jsonwebtoken')
const User = require('../models/User')
const { JWT_ACCESS_SECRET } = require('../config/env')

/** Sets req.user when Bearer token is valid; does not fail when missing/invalid */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next()

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET)
    const user = await User.findById(decoded._id).select('_id email role name isActive')
    if (user?.isActive) {
      req.user = {
        _id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
      }
    }
  } catch {
    // ignore
  }
  next()
}

module.exports = optionalAuth
