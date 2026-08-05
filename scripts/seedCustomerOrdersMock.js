/**
 * Seeds realistic Material Orders + Order Quotations (with delivered/pending line items)
 * for customer1@example.com so the Material Orders / Order Quotations / Order Details
 * screens have real, varied-stage data to look at.
 *
 * Per project, creates 3 orders spanning the full stepper:
 *   A) new_order          — just placed, no quotation yet
 *   B) quotation_received — staff sent a quotation, awaiting customer response
 *   C) completed          — quotation approved, both line items delivered
 *
 * Safe to re-run: skips a lead once it already has >= 4 non-cancelled orders.
 * Usage: node scripts/seedCustomerOrdersMock.js
 */
const mongoose = require('mongoose')
require('dotenv').config()

const Lead = require('../src/models/Lead')
const Customer = require('../src/models/Customer')
const User = require('../src/models/User')
const Delivery = require('../src/models/Delivery')
const MaterialRequest = require('../src/models/MaterialRequest')
const OrderQuotation = require('../src/models/OrderQuotation')

let mrCounter = 0
let oqCounter = 0
const nextRequestId = async () => {
  if (!mrCounter) mrCounter = await MaterialRequest.countDocuments({})
  mrCounter += 1
  return `MR-${new Date().getFullYear()}-${String(mrCounter).padStart(4, '0')}`
}
const nextQuotationNumber = async () => {
  if (!oqCounter) oqCounter = await OrderQuotation.countDocuments({})
  oqCounter += 1
  return `INV/${new Date().getFullYear()}/${String(oqCounter).padStart(4, '0')}`
}

const COIL_ITEMS = [
  { name: 'Black 26ga', quantity: 30, unit: 'ft', lengthFeet: 24, color: 'Black', unitPrice: 10 },
  { name: 'Galvanized 24ga', quantity: 18, unit: 'ft', lengthFeet: 16, color: 'Silver', unitPrice: 12 },
]

async function createQuotation({ order, lead, customerId, uploader, approve }) {
  const lineItems = COIL_ITEMS.map((i) => ({
    coilType: i.name, lengthFeet: i.lengthFeet, quantity: i.quantity, color: i.color,
    unitPrice: i.unitPrice, amount: i.unitPrice * i.quantity,
  }))
  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0)
  const tax = Math.round(subtotal * 0.1)
  const freight = 27

  const quotation = await OrderQuotation.create({
    quotationNumber: await nextQuotationNumber(),
    orderId: order._id,
    leadId: lead._id,
    customerId,
    buildingLabel: order.buildingLabel,
    sellerName: 'STORAGE MATERIAL',
    sellerAddress: 'San Francisco SA 65798, United States',
    sellerEmail: 'info@company.com',
    lineItems,
    subtotal,
    tax,
    freight,
    totalValue: subtotal + tax + freight,
    createdBy: uploader._id,
    status: approve ? 'approved' : 'sent',
    respondedAt: approve ? new Date() : null,
  })

  return quotation
}

async function seedLead(lead, customer, uploader) {
  const existing = await MaterialRequest.countDocuments({ leadId: lead._id, status: { $ne: 'cancelled' } })
  if (existing >= 4) {
    console.log(`  skip ${lead.jobId} — already has ${existing} active orders`)
    return
  }

  const delivery = await Delivery.findOne({ leadId: lead._id }).select('_id deliveryNumber').lean()

  // A) new_order — no quotation
  await MaterialRequest.create({
    requestId: await nextRequestId(),
    leadId: lead._id,
    buildingLabel: 'Building A',
    source: 'customer',
    requestedByCustomer: customer._id,
    requestedItems: COIL_ITEMS.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, lengthFeet: i.lengthFeet, color: i.color })),
    requiredBy: new Date(Date.now() + 20 * 86400000),
    priority: 'medium',
    status: 'pending',
  })

  // B) quotation_received — quotation sent, awaiting response
  const orderB = await MaterialRequest.create({
    requestId: await nextRequestId(),
    leadId: lead._id,
    buildingLabel: 'Building B',
    source: 'customer',
    requestedByCustomer: customer._id,
    requestedItems: COIL_ITEMS.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, lengthFeet: i.lengthFeet, color: i.color })),
    requiredBy: new Date(Date.now() + 15 * 86400000),
    priority: 'high',
    status: 'pending',
  })
  await createQuotation({ order: orderB, lead, customerId: customer._id, uploader, approve: false })

  // C) completed — quotation approved, all items delivered
  const orderC = await MaterialRequest.create({
    requestId: await nextRequestId(),
    leadId: lead._id,
    buildingLabel: 'Building C',
    source: 'customer',
    requestedByCustomer: customer._id,
    requestedItems: COIL_ITEMS.map((i) => ({
      name: i.name, quantity: i.quantity, unit: i.unit, lengthFeet: i.lengthFeet, color: i.color,
      deliveryStatus: 'delivered',
      deliveryId: delivery?._id || null,
      deliveryReference: delivery?.deliveryNumber || 'DEL-001',
      deliveredAt: new Date(),
    })),
    requiredBy: new Date(Date.now() - 5 * 86400000),
    priority: 'medium',
    status: 'fulfilled',
  })
  await createQuotation({ order: orderC, lead, customerId: customer._id, uploader, approve: true })

  console.log(`  seeded 3 orders (new_order / quotation_received / completed) for ${lead.jobId} (${lead.projectName || 'untitled'})`)
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const customer = await Customer.findOne({ email: 'customer1@example.com' }).select('_id email').lean()
  if (!customer) throw new Error('customer1@example.com not found')

  const uploader = await User.findOne({ email: 'admin@flyweis.test' }).select('_id name').lean()
  if (!uploader) throw new Error('admin@flyweis.test not found')

  const leads = await Lead.find({ customerId: customer._id }).select('_id projectName jobId').lean()
  console.log(`Seeding orders for ${leads.length} project(s) owned by ${customer.email}`)

  for (const lead of leads) {
    await seedLead(lead, customer, uploader)
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
