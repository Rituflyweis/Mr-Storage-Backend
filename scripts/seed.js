/**
 * Seed script — run once after setting up the database.
 * Creates the first admin user and initialises the RoundRobinTracker.
 *
 * Usage:
 *   node scripts/seed.js
 *
 * To create extra users non-interactively:
 *   SEED_EMAIL=sales@co.com SEED_PASS=pass123 SEED_ROLE=sales SEED_NAME="Sales Rep" node scripts/seed.js
 */

require('dotenv').config()

const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

// Load env with validation (exits if missing)
const { MONGO_URI } = require('../src/config/env')
const User = require('../src/models/User')
const RoundRobinTracker = require('../src/models/RoundRobinTracker')

const DEFAULT_ADMIN = {
  name:     process.env.SEED_NAME  || 'Admin',
  email:    process.env.SEED_EMAIL || 'admin@construction.com',
  password: process.env.SEED_PASS  || 'Admin@123',
  role:     process.env.SEED_ROLE  || 'admin',
}

const run = async () => {
  await mongoose.connect(MONGO_URI)
  console.log('[Seed] Connected to MongoDB')

  // ── Create user ───────────────────────────────────────────────────────────
  const exists = await User.findOne({ email: DEFAULT_ADMIN.email.toLowerCase() })

  if (exists) {
    console.log(`[Seed] User already exists: ${exists.email} (${exists.role}) — skipping creation`)
  } else {
    const hashed = await bcrypt.hash(DEFAULT_ADMIN.password, 12)
    const user = await User.create({
      name:     DEFAULT_ADMIN.name,
      email:    DEFAULT_ADMIN.email.toLowerCase(),
      password: hashed,
      role:     DEFAULT_ADMIN.role,
      isActive: true,
    })
    console.log(`[Seed] Created user: ${user.email} | role: ${user.role}`)
    console.log(`       Login with: ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password}`)
  }

  // ── Initialise RoundRobinTracker (singleton) ──────────────────────────────
  const tracker = await RoundRobinTracker.findOne()
  if (!tracker) {
    const salesEmployees = await User.find({ role: 'sales', isActive: true }).select('_id')
    await RoundRobinTracker.create({
      lastAssignedIndex: -1,
      activeEmployees: salesEmployees.map(u => u._id),
    })
    console.log(`[Seed] RoundRobinTracker initialised with ${salesEmployees.length} active sales employee(s)`)
  } else {
    console.log('[Seed] RoundRobinTracker already exists — skipping')
  }

  console.log('\n[Seed] Done.')
  await mongoose.disconnect()
  process.exit(0)
}

run().catch(err => {
  console.error('[Seed] Error:', err.message)
  process.exit(1)
})
