// Mock PaymentApproval records for testing the Requested Date / Requested By / Category filters
// and export on the Payment Approvals screen. Links to real users so populate() and the
// requestedBy filter dropdown have real data.
require('dotenv').config()
const mongoose = require('mongoose')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const PaymentApproval = require('../src/models/PaymentApproval')
  const User = require('../src/models/User')

  const users = await User.find({ role: { $in: ['admin', 'plant'] } }).select('_id').limit(2).lean()
  if (!users.length) { console.log('No admin/plant users found, aborting'); process.exit(1) }
  const requester = (i) => users[i % users.length]._id

  const now = new Date()
  const thisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), day)
  const lastMonth = (day) => new Date(now.getFullYear(), now.getMonth() - 1, day)

  const rows = [
    { payee: 'Steel Supply Co',      payeeType: 'vendor',  category: 'vendor_payment',   amount: 45000, department: 'Procurement', status: 'pending',  createdAt: thisMonth(3) },
    { payee: 'Dave Gas Shipping',    payeeType: 'shipper', category: 'shipper_payment',  amount: 12500, department: 'Logistics',   status: 'approved', createdAt: thisMonth(5) },
    { payee: 'Crane Rentals Inc',    payeeType: 'vendor',  category: 'equipment',         amount: 8200,  department: 'Plant Ops',   status: 'pending',  createdAt: thisMonth(9) },
    { payee: 'Office Supplies Co',   payeeType: 'vendor',  category: 'other_expenses',    amount: 640,   department: 'Admin',       status: 'rejected', createdAt: thisMonth(11) },
    { payee: 'Twin Creek Freight',   payeeType: 'carrier',  category: 'shipper_payment',  amount: 21000, department: 'Logistics',   status: 'approved', createdAt: lastMonth(8) },
    { payee: 'MBS Steel Direct',     payeeType: 'vendor',  category: 'vendor_payment',    amount: 67500, department: 'Procurement', status: 'under_review', createdAt: lastMonth(14) },
    { payee: 'Forklift Maintenance', payeeType: 'vendor',  category: 'equipment',          amount: 3100,  department: 'Plant Ops',   status: 'pending',  createdAt: thisMonth(15) },
    { payee: 'Regional Trucking Co', payeeType: 'carrier',  category: 'shipper_payment',   amount: 15800, department: 'Logistics',   status: 'disputed', createdAt: lastMonth(20) },
  ]

  let inserted = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const count = await PaymentApproval.countDocuments()
    const paymentId = `PR-${r.createdAt.getFullYear()}-${String(count + 1).padStart(5, '0')}`
    await PaymentApproval.create({
      paymentId,
      payee: r.payee,
      payeeType: r.payeeType,
      category: r.category,
      amount: r.amount,
      department: r.department,
      status: r.status,
      requestedBy: requester(i),
      createdAt: r.createdAt,
      reviewedBy: r.status === 'approved' || r.status === 'rejected' ? requester(i + 1) : null,
      reviewedAt: r.status === 'approved' || r.status === 'rejected' ? new Date(r.createdAt.getTime() + 2 * 86400000) : null,
    })
    inserted++
  }
  console.log('Inserted', inserted, 'PaymentApproval rows')
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
