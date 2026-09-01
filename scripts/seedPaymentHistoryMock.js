// Mock data for testing Payment History (payment-status) Method/Status/Search filters and the
// Vendor Payments / Carrier Payments stat cards:
//  1. Backfills paymentMethod on a few existing paid invoices (field is new, real ones are null).
//  2. Adds a couple more approved vendor/carrier PaymentApproval records for stat-card variety.
require('dotenv').config()
const mongoose = require('mongoose')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const Invoice = require('../src/models/Invoice')
  const PaymentApproval = require('../src/models/PaymentApproval')
  const User = require('../src/models/User')

  const methods = ['bank_transfer', 'credit_card', 'cheque', 'upi', 'cash']
  const paidInvoices = await Invoice.find({ status: 'paid' }).limit(10).lean()
  let updated = 0
  for (let i = 0; i < paidInvoices.length; i++) {
    await Invoice.updateOne(
      { _id: paidInvoices[i]._id },
      { $set: { paymentMethod: methods[i % methods.length], paidAt: paidInvoices[i].paidAt || paidInvoices[i].createdAt } }
    )
    updated++
  }
  console.log('Backfilled paymentMethod on', updated, 'paid invoices')

  const users = await User.find({ role: { $in: ['admin', 'plant'] } }).select('_id').limit(2).lean()
  if (users.length) {
    const now = new Date()
    const rows = [
      { payee: 'ABC Metal Works',    payeeType: 'vendor',  category: 'vendor_payment',  amount: 32000, department: 'Procurement', createdAt: now },
      { payee: 'Mountain Freight',   payeeType: 'carrier', category: 'shipper_payment', amount: 9400,  department: 'Logistics',   createdAt: now },
    ]
    let inserted = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const count = await PaymentApproval.countDocuments()
      const paymentId = `PR-${r.createdAt.getFullYear()}-${String(count + 1).padStart(5, '0')}`
      await PaymentApproval.create({
        paymentId, payee: r.payee, payeeType: r.payeeType, category: r.category, amount: r.amount,
        department: r.department, status: 'approved', requestedBy: users[i % users.length]._id,
        reviewedBy: users[i % users.length]._id, reviewedAt: r.createdAt, createdAt: r.createdAt,
      })
      inserted++
    }
    console.log('Inserted', inserted, 'more approved vendor/carrier PaymentApproval rows')
  }

  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
