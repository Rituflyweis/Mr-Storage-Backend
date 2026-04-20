const { forbidden } = require('../utils/apiResponse')

// Usage: roleGuard(['admin'])  or  roleGuard(['admin', 'sales'])
const roleGuard = (allowedRoles = []) => (req, res, next) => {
  if (!req.user) return forbidden(res)
  if (!allowedRoles.includes(req.user.role)) {
    return forbidden(res, `Access denied. Requires role: ${allowedRoles.join(' or ')}`)
  }
  next()
}

module.exports = roleGuard
