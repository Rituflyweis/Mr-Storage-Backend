const { NODE_ENV } = require('../config/env')

// Must be registered LAST in app.js with app.use(errorHandler)
const errorHandler = (err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack ? '\n' + err.stack : '')

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => ({ msg: e.message, path: e.path }))
    return res.status(400).json({ success: false, message: 'Validation error', errors })
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field'
    return res.status(409).json({ success: false, message: `Duplicate value for ${field}` })
  }

  // Mongoose cast error (bad ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid ${err.path}: ${err.value}` })
  }

  const statusCode = err.statusCode || 500
  const message = NODE_ENV === 'production' && statusCode === 500
    ? 'Internal server error'
    : err.message || 'Internal server error'

  res.status(statusCode).json({ success: false, message })
}

module.exports = errorHandler
