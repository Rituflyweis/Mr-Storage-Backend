/**
 * Create a user from the command line.
 *
 * Usage:
 *   node scripts/createUser.js <name> <email> <password> <role>
 *
 * Example:
 *   node scripts/createUser.js "John Sales" john@co.com pass123 sales
 *   node scripts/createUser.js "Jane Admin" jane@co.com pass123 admin
 *
 * Roles: admin | sales | construction | plant | account
 */

require('dotenv').config()

const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { MONGO_URI } = require('../src/config/env')
const User = require('../src/models/User')
const RoundRobinTracker = require('../src/models/RoundRobinTracker')
const { USER_ROLES } = require('../src/config/constants')

const [,, name, email, password, role] = process.argv

if (!name || !email || !password || !role) {
  console.error('Usage: node scripts/createUser.js <name> <email> <password> <role>')
  console.error('Roles:', USER_ROLES.join(' | '))
  process.exit(1)
}

if (!USER_ROLES.includes(role)) {
  console.error(`Invalid role: ${role}. Must be one of: ${USER_ROLES.join(', ')}`)
  process.exit(1)
}

const run = async () => {
  await mongoose.connect(MONGO_URI)

  const exists = await User.findOne({ email: email.toLowerCase() })
  if (exists) {
    console.error(`User already exists: ${email}`)
    process.exit(1)
  }

  const hashed = await bcrypt.hash(password, 12)
  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: hashed,
    role,
    isActive: true,
  })

  console.log(`Created: ${user.name} <${user.email}> | role: ${user.role}`)

  // Rebuild round robin if this is a sales user
  if (role === 'sales') {
    const salesEmployees = await User.find({ role: 'sales', isActive: true }).select('_id')
    const ids = salesEmployees.map(u => u._id)
    let tracker = await RoundRobinTracker.findOne()
    if (!tracker) {
      await RoundRobinTracker.create({ lastAssignedIndex: -1, activeEmployees: ids })
    } else {
      tracker.activeEmployees = ids
      await tracker.save()
    }
    console.log(`RoundRobinTracker updated: ${ids.length} active sales employee(s)`)
  }

  await mongoose.disconnect()
  process.exit(0)
}

run().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
