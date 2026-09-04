// Additional mock pending Tax rows (future due dates, spread across states) for testing the
// state-wise-tax/upcoming-deadlines endpoint. Additive on top of seedTaxMockData.js — run once.
require('dotenv').config()
const mongoose = require('mongoose')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const Tax = require('../src/models/Tax')
  const Lead = require('../src/models/Lead')
  const User = require('../src/models/User')

  const leads = await Lead.find({ customerId: { $ne: null } }).select('_id customerId').limit(3).lean()
  const admin = await User.findOne({ role: 'admin' }).select('_id').lean()
  if (!leads.length || !admin) { console.log('Missing leads or admin user, aborting'); process.exit(1) }

  const inDays = (n) => new Date(Date.now() + n * 86400000)

  const rows = [
    { state: 'Texas',      amount: 90000,  dueDate: inDays(32), lead: leads[0] },
    { state: 'California', amount: 150000, dueDate: inDays(32), lead: leads[1] || leads[0] },
    { state: 'Texas',      amount: 110000, dueDate: inDays(40), lead: leads[0] },
    { state: 'California', amount: 130000, dueDate: inDays(45), lead: leads[1] || leads[0] },
    { state: 'Florida',    amount: 70000,  dueDate: inDays(32), lead: leads[2] || leads[0] },
    { state: 'New York',   amount: 200000, dueDate: inDays(50), lead: leads[0] },
  ]

  let inserted = 0
  for (const r of rows) {
    await Tax.create({
      state: r.state,
      dueDate: r.dueDate,
      amount: r.amount,
      status: 'pending',
      filingFrequency: 'monthly',
      leadId: r.lead._id,
      customerId: r.lead.customerId,
      createdBy: admin._id,
    })
    inserted++
  }
  console.log('Inserted', inserted, 'additional pending Tax rows')
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
