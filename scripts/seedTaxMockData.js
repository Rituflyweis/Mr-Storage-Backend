// Mock Tax records for testing tax-filing filters (projectId/clientId/search/date range) and
// tax-filing/stats — links to a couple of real leads/customers so populate() and search work.
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

  const now = new Date()
  const thisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), day)
  const lastMonth = (day) => new Date(now.getFullYear(), now.getMonth() - 1, day)

  const rows = [
    { state: 'Texas',      amount: 120000, status: 'pending', dueDate: thisMonth(28), createdAt: thisMonth(3),  lead: leads[0] },
    { state: 'Texas',      amount: 95000,  status: 'paid',    dueDate: thisMonth(15), createdAt: thisMonth(5),  lead: leads[0], paidAt: thisMonth(10) },
    { state: 'California', amount: 210000, status: 'pending', dueDate: thisMonth(30), createdAt: thisMonth(8),  lead: leads[1] || leads[0] },
    { state: 'California', amount: 180000, status: 'paid',    dueDate: lastMonth(20), createdAt: lastMonth(2),  lead: leads[1] || leads[0], paidAt: lastMonth(18) },
    { state: 'Florida',    amount: 75000,  status: 'pending', dueDate: thisMonth(25), createdAt: thisMonth(12), lead: leads[2] || leads[0] },
    { state: 'Florida',    amount: 60000,  status: 'paid',    dueDate: lastMonth(28), createdAt: lastMonth(6),  lead: leads[2] || leads[0], paidAt: lastMonth(25) },
    { state: 'New York',   amount: 300000, status: 'pending', dueDate: thisMonth(29), createdAt: thisMonth(1),  lead: leads[0] },
    { state: 'New York',   amount: 250000, status: 'paid',    dueDate: lastMonth(15), createdAt: lastMonth(10), lead: leads[0], paidAt: lastMonth(14) },
  ]

  let inserted = 0
  for (const r of rows) {
    await Tax.create({
      state: r.state,
      dueDate: r.dueDate,
      amount: r.amount,
      status: r.status,
      leadId: r.lead._id,
      customerId: r.lead.customerId,
      createdBy: admin._id,
      paidBy: r.status === 'paid' ? admin._id : null,
      paidAt: r.paidAt || null,
      createdAt: r.createdAt,
    })
    inserted++
  }
  console.log('Inserted', inserted, 'Tax rows linked to', leads.length, 'leads')
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
