const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Invoice = require('../src/models/Invoice')
const User = require('../src/models/User')
const generateCustomerId = require('../src/utils/generateCustomerId')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)

  const email = 'customer2@example.com'
  const password = 'Test@1234'

  let customer = await Customer.findOne({ email })
  if (!customer) {
    const customerId = await generateCustomerId()
    const hashed = await bcrypt.hash(password, 12)
    customer = await Customer.create({
      customerId,
      firstName: 'Test',
      lastName: 'Customer2',
      email,
      phone: { number: '5550009876', countryCode: '+1' },
      password: hashed,
      isActive: true,
      source: 'chat',
    })
    console.log('Created customer:', customer.email, customer.customerId, customer._id.toString())
  } else {
    const hashed = await bcrypt.hash(password, 12)
    customer.password = hashed
    await customer.save()
    console.log('Customer already existed — password reset to known value:', customer.email)
  }

  const staff = await User.findOne()
  if (!staff) { console.log('No User exists — cannot create Lead/Invoice'); process.exit(1) }

  let lead = await Lead.findOne({ customerId: customer._id })
  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id,
      projectName: 'Test Warehouse Project 2',
      buildingType: 'Warehouse',
      location: 'Dallas, TX',
      quoteValue: 100000,
      lifecycleStatus: 'converted_to_po',
      isRaisedToPO: true,
      source: 'customer_portal',
      lifecycleHistory: [{ stage: 'converted_to_po', changedAt: new Date(), changedBy: null }],
    })
    console.log('Created lead:', lead.projectName, lead.jobId, lead._id.toString())
  } else if (!lead.isRaisedToPO) {
    lead.isRaisedToPO = true
    await lead.save()
  }

  const existingPaidInvoice = await Invoice.findOne({ leadId: lead._id, status: 'paid' })
  if (!existingPaidInvoice) {
    const depositAmount = Math.round(lead.quoteValue * 0.3)
    const invoice = await Invoice.create({
      leadId: lead._id,
      customerId: customer._id,
      createdBy: staff._id,
      invoiceNumber: `INV-TEST-${Date.now()}`,
      description: '30% deposit invoice (test)',
      date: new Date(),
      totalAmount: depositAmount,
      status: 'paid',
    })
    console.log('Created paid invoice:', invoice.invoiceNumber, 'amount:', depositAmount)
  }

  console.log('\nDone.')
  console.log('Email:', email)
  console.log('Password:', password)
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
