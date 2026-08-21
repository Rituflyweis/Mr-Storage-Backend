// Standing test staff accounts (admin + plant) for Claude's own API testing — NEVER reset real
// accounts' passwords again. Safe to re-run; upserts by email.
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const ACCOUNTS = [
  { role: 'admin', email: 'claude.qa.admin@internal-test.mrstorage.dev', name: 'Claude QA Admin' },
  { role: 'plant', email: 'claude.qa.plant@internal-test.mrstorage.dev', name: 'Claude QA Plant' },
  { role: 'sales', email: 'claude.qa.sales@internal-test.mrstorage.dev', name: 'Claude QA Sales' },
]
const PASSWORD = 'ClaudeQA@2026'

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)
  const User = require('../src/models/User')
  const hashed = await bcrypt.hash(PASSWORD, 12)

  for (const acc of ACCOUNTS) {
    let user = await User.findOne({ email: acc.email })
    if (!user) {
      user = await User.create({ name: acc.name, email: acc.email, password: hashed, role: acc.role, phone: '+10000000000', isActive: true })
      console.log('Created', acc.role, ':', user._id.toString())
    } else {
      user.password = hashed
      await user.save()
      console.log('Password reset on existing', acc.role, ':', user._id.toString())
    }
  }
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
