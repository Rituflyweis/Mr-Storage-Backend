const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const { CLIENT_URL, NODE_ENV } = require('./src/config/env')
const errorHandler = require('./src/middleware/errorHandler')

const app = express()

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet())

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: NODE_ENV === 'production' ? CLIENT_URL : '*',
  credentials: true,
}))

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// express.json()/urlencoded() leave req.body as undefined (not {}) when the request
// has no Content-Type or an empty body — every controller destructures straight off
// req.body, so guarantee it's always at least an object here rather than patching
// every call site.
app.use((req, res, next) => {
  if (req.body === undefined) req.body = {}
  next()
})

// // ── Global rate limit ─────────────────────────────────────────────────────────
// app.use(rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 300,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { success: false, message: 'Too many requests' },
// }))

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', env: NODE_ENV }))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',           require('./src/routes/auth.routes'))
app.use('/api/customer/auth',  require('./src/routes/customerAuth.routes'))
app.use('/api/customer',       require('./src/routes/customerPortal.routes'))
app.use('/api/public',        require('./src/routes/public.routes'))
app.use('/api/admin',   require('./src/routes/admin/index'))
app.use('/api/sales',   require('./src/routes/sales/index'))
// Alias without /api — some clients call /sales/* directly on the API host
app.use('/sales',         require('./src/routes/sales/index'))
app.use('/api/account',       require('./src/routes/account/index'))
app.use('/api/plant',         require('./src/routes/plant/index'))
app.use('/api/construction',  require('./src/routes/construction/index'))
app.use('/api',         require('./src/routes/common/index'))
app.use('/api/v1',      require('./src/routes/material/index'))

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` })
})

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler)

module.exports = app
