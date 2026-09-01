/**
 * Ensure Postman admin exists with known credentials.
 * Creates or resets password for admin@construction.com / Admin@123
 *
 * Run: node scripts/ensureAdminConstruction.js
 */
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()
const User = require('../src/models/User')

const EMAIL = 'admin@construction.com'
const PASSWORD = 'Admin@123'

const allPerms = {
  leadAccess:      { view: true, edit: true, delete: true },
  followupsAccess: { view: true, edit: true, delete: true },
  reportsAccess:   { view: true, edit: true, delete: true },
  aiSupportAccess: { view: true, edit: true, delete: true },
  settingsAccess:  { view: true, edit: true, delete: true },
  employees:       { view: true, edit: true, delete: true },
  taxReport:       { view: true, edit: true, delete: true },
  insights:        { view: true, edit: true, delete: true },
  addNewLead:      { view: true, edit: true, delete: true },
  scheduleMeeting: { view: true, edit: true, delete: true },
  generateReport:  { view: true, edit: true, delete: true },
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is required')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO_URI)
  const hashed = await bcrypt.hash(PASSWORD, 12)

  let user = await User.findOne({ email: EMAIL.toLowerCase() })
  if (user) {
    user.password = hashed
    user.passwordChangedAt = new Date()
    user.role = 'admin'
    user.isActive = true
    user.permissions = allPerms
    await user.save()
    console.log('Updated password:', user.email, '| role:', user.role)
  } else {
    user = await User.create({
      name: 'Admin',
      email: EMAIL.toLowerCase(),
      password: hashed,
      role: 'admin',
      department: 'Management',
      isActive: true,
      permissions: allPerms,
    })
    console.log('Created admin:', user.email, user._id.toString())
  }

  const verify = await User.findOne({ email: EMAIL.toLowerCase() }).select('+password')
  const ok = await bcrypt.compare(PASSWORD, verify.password)
  console.log('Password verified:', ok)
  console.log('Login with POST /api/auth/login →', EMAIL, '/', PASSWORD)

  await mongoose.disconnect()
  process.exit(ok ? 0 : 1)
}

run().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
