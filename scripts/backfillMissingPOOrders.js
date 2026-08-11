const mongoose = require('mongoose')
require('dotenv').config()
const Lead = require('../src/models/Lead')
const Invoice = require('../src/models/Invoice')
const POOrder = require('../src/models/POOrder')
const User = require('../src/models/User')
const generatePONumber = require('../src/utils/generatePONumber')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const plantUser = await User.findOne({ role: 'plant' })
  if (!plantUser) { console.log('No plant user found — cannot assign'); process.exit(1) }
  console.log('Assigning to plant user:', plantUser.name, plantUser.email)

  const leads = await Lead.find({ isRaisedToPO: true }).lean()

  for (const lead of leads) {
    const existingPO = await POOrder.findOne({ leadId: lead._id })
    if (existingPO) {
      console.log(`SKIP ${lead.jobId} (${lead.projectName}) — PO already exists`)
      continue
    }

    const paidInvoice = await Invoice.findOne({ leadId: lead._id, status: 'paid' }).sort({ createdAt: -1 })
    if (!paidInvoice) {
      console.log(`SKIP ${lead.jobId} (${lead.projectName}) — no paid invoice found`)
      continue
    }

    if (!paidInvoice.poNumber) {
      paidInvoice.poNumber = await generatePONumber()
      await paidInvoice.save()
    }

    const order = await POOrder.create({
      leadId: lead._id,
      customerId: lead.customerId,
      raisedBy: plantUser._id,
      assignedTo: plantUser._id,
      invoiceId: paidInvoice._id,
      poNumber: paidInvoice.poNumber,
      status: 'approved',
    })

    await Lead.updateOne(
      { _id: lead._id },
      { $set: { poNumber: paidInvoice.poNumber, poStatus: 'approved' } }
    )

    console.log(`CREATED PO ${order.poNumber} for ${lead.jobId} (${lead.projectName}) -> assigned to ${plantUser.email}`)
  }

  console.log('\nDone.')
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1) })
