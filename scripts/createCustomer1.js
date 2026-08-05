const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()
const Customer = require('../src/models/Customer')
const generateCustomerId = require('../src/utils/generateCustomerId')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)

  const email = 'customer1@example.com'
  const exists = await Customer.findOne({ email })
  if (exists) {
    console.log('Already exists:', exists.email, exists.customerId)
    process.exit(0)
  }

  const customerId = await generateCustomerId()
  const hashed = await bcrypt.hash('Test@1234', 12)

  const customer = await Customer.create({
    customerId,
    firstName: 'Test',
    lastName: 'Customer',
    email,
    phone: { number: '5550001234', countryCode: '+1' },
    password: hashed,
    isActive: true,
    source: 'chat',
  })

  console.log('Created:', customer.email, customer.customerId, customer._id.toString())
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
