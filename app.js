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

// ── Global rate limit ─────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
}))

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', env: NODE_ENV }))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',   require('./src/routes/auth.routes'))
app.use('/api/public', require('./src/routes/public.routes'))
app.use('/api/admin',  require('./src/routes/admin/index'))
app.use('/api/sales',  require('./src/routes/sales/index'))
app.use('/api',        require('./src/routes/common/index'))

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` })
})

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler)

module.exports = app
