const mongoose = require('mongoose')
require('dotenv').config()
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Invoice = require('../src/models/Invoice')
const User = require('../src/models/User')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)

  const customer = await Customer.findOne({ email: 'customer1@example.com' })
  if (!customer) {
    console.log('customer1@example.com not found — run createCustomer1.js first')
    process.exit(1)
  }

  const anyUser = await User.findOne()
  if (!anyUser) {
    console.log('No User exists to set as createdBy — cannot create Lead/Invoice')
    process.exit(1)
  }

  let lead = await Lead.findOne({ customerId: customer._id })
  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id,
      projectName: 'Test Warehouse Project',
      buildingType: 'Warehouse',
      location: 'Austin, TX',
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
    console.log('Updated existing lead to isRaisedToPO: true')
  } else {
    console.log('Lead already exists and is raised to PO:', lead._id.toString())
  }

  const existingPaidInvoice = await Invoice.findOne({ leadId: lead._id, status: 'paid' })
  if (!existingPaidInvoice) {
    const depositAmount = Math.round(lead.quoteValue * 0.3)
    const invoice = await Invoice.create({
      leadId: lead._id,
      customerId: customer._id,
      createdBy: anyUser._id,
      invoiceNumber: `INV-TEST-${Date.now()}`,
      description: '30% deposit invoice (test)',
      date: new Date(),
      totalAmount: depositAmount,
      status: 'paid',
    })
    console.log('Created paid invoice:', invoice.invoiceNumber, 'amount:', depositAmount, '(', Math.round((depositAmount / lead.quoteValue) * 100), '% of quote )')
  } else {
    console.log('Paid invoice already exists:', existingPaidInvoice.invoiceNumber)
  }

  console.log('Done. customer1@example.com should now be able to log in.')
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
