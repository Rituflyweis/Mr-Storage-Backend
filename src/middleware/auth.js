const jwt = require('jsonwebtoken')
const { JWT_ACCESS_SECRET } = require('../config/env')
const { unauthorized } = require('../utils/apiResponse')

const verifyToken = (req, res, next) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res, 'No token provided')
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET)
    req.user = decoded // { _id, email, role, name }
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired')
    return unauthorized(res, 'Invalid token')
  }
}

module.exports = verifyToken
