// Mock Vendor and Freight Carrier invoices for testing the invoiceType/category fields just
// added to Invoice, and the Project/Date Range filters + export on both admin invoice screens.
require('dotenv').config()
const mongoose = require('mongoose')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const Invoice = require('../src/models/Invoice')
  const Vendor = require('../src/models/Vendor')
  const FreightCarrier = require('../src/models/FreightCarrier')
  const Lead = require('../src/models/Lead')
  const User = require('../src/models/User')

  const vendors = await Vendor.find({}).select('vendorName').limit(3).lean()
  const carriers = await FreightCarrier.find({}).select('carrierName').limit(2).lean()
  const leads = await Lead.find({}).select('_id').limit(3).lean()
  const admin = await User.findOne({ role: 'admin' }).select('_id').lean()
  if (!vendors.length || !carriers.length || !leads.length || !admin) {
    console.log('Missing vendors/carriers/leads/admin, aborting'); process.exit(1)
  }

  const now = new Date()
  const thisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), day)
  const lastMonth = (day) => new Date(now.getFullYear(), now.getMonth() - 1, day)

  const vendorRows = [
    { vendor: vendors[0], lead: leads[0], amount: 45000, category: 'product', status: 'paid', date: thisMonth(3) },
    { vendor: vendors[1] || vendors[0], lead: leads[1] || leads[0], amount: 12000, category: 'service', status: 'sent', date: thisMonth(8) },
    { vendor: vendors[2] || vendors[0], lead: leads[2] || leads[0], amount: 6500, category: 'other', status: 'draft', date: thisMonth(12) },
    { vendor: vendors[0], lead: leads[0], amount: 30000, category: 'product', status: 'overdue', date: lastMonth(5) },
    { vendor: vendors[1] || vendors[0], lead: leads[1] || leads[0], amount: 18000, category: 'service', status: 'paid', date: lastMonth(15) },
  ]

  const carrierRows = [
    { carrier: carriers[0], lead: leads[0], amount: 9500, status: 'paid', date: thisMonth(4) },
    { carrier: carriers[1] || carriers[0], lead: leads[1] || leads[0], amount: 15000, status: 'sent', date: thisMonth(10) },
    { carrier: carriers[0], lead: leads[2] || leads[0], amount: 7200, status: 'overdue', date: lastMonth(20) },
  ]

  let inserted = 0
  for (let i = 0; i < vendorRows.length; i++) {
    const r = vendorRows[i]
    await Invoice.create({
      leadId: r.lead._id,
      invoiceType: 'vendor',
      vendorId: r.vendor._id,
      payeeName: r.vendor.vendorName,
      category: r.category,
      createdBy: admin._id,
      invoiceNumber: `VINV-${r.date.getFullYear()}-${String(1000 + i)}`,
      description: `Vendor invoice from ${r.vendor.vendorName}`,
      date: r.date,
      totalAmount: r.amount,
      status: r.status,
      daysToPay: 30,
    })
    inserted++
  }
  for (let i = 0; i < carrierRows.length; i++) {
    const r = carrierRows[i]
    await Invoice.create({
      leadId: r.lead._id,
      invoiceType: 'freight_carrier',
      carrierId: r.carrier._id,
      payeeName: r.carrier.carrierName,
      createdBy: admin._id,
      invoiceNumber: `FINV-${r.date.getFullYear()}-${String(2000 + i)}`,
      description: `Freight invoice from ${r.carrier.carrierName}`,
      date: r.date,
      totalAmount: r.amount,
      status: r.status,
      daysToPay: 15,
    })
    inserted++
  }

  console.log('Inserted', inserted, 'invoices (vendor + freight_carrier)')
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
