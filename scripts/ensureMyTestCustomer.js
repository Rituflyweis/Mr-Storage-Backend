// Standing test customer for Claude's own API testing — NEVER reset real accounts' passwords again.
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const EMAIL = 'claude.qa@internal-test.mrstorage.dev'
const PASSWORD = 'ClaudeQA@2026'

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)
  const Customer = require('../src/models/Customer')
  const hashed = await bcrypt.hash(PASSWORD, 12)

  let customer = await Customer.findOne({ email: EMAIL })
  if (!customer) {
    customer = await Customer.create({
      firstName: 'Claude', lastName: 'QA', email: EMAIL, password: hashed,
      customerId: 'CUST-QA01', phone: { number: '0000000000', countryCode: '+1' },
    })
    console.log('Created:', customer._id.toString())
  } else {
    customer.password = hashed
    await customer.save()
    console.log('Password reset on existing:', customer._id.toString())
  }
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
