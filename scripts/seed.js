/**
 * Seed script — creates admin, staff users, customers, leads, and mock data
 * Run: node scripts/seed.js
 */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const MONGO_URI = process.env.MONGO_URI
if (!MONGO_URI) { console.error('❌ MONGO_URI env variable is required'); process.exit(1) }

const User               = require('../src/models/User')
const Customer           = require('../src/models/Customer')
const Lead               = require('../src/models/Lead')
const Building           = require('../src/models/Building')
const FollowUp           = require('../src/models/FollowUp')
const Meeting            = require('../src/models/Meeting')
const POOrder            = require('../src/models/POOrder')
const FreightCarrier     = require('../src/models/FreightCarrier')
const Delivery           = require('../src/models/Delivery')
const FreightBid         = require('../src/models/FreightBid')
const generateCustomerId = require('../src/utils/generateCustomerId')

const hash = (pw) => bcrypt.hashSync(pw, 10)

async function seed () {
  await mongoose.connect(MONGO_URI)
  console.log('✅ Connected to MongoDB')

  // Clean old seed data
  await User.deleteMany({ email: /@flyweis\.test$/ })
  await Customer.deleteMany({ email: /@flyweis\.test$/ })
  await FreightCarrier.deleteMany({ email: /@flyweis\.test$/ })
  await Delivery.deleteMany({ deliveryNumber: /^DEL-000[1-9]$/ })
  await POOrder.deleteMany({ poNumber: /^PO-000[1-9]$/ })
  console.log('🧹 Cleaned old seed data')

  // ── STAFF USERS ────────────────────────────────────────────────────────────
  const allPerms = {
    leadAccess:      { view: true, edit: true, delete: true },
    followupsAccess: { view: true, edit: true, delete: true },
    reportsAccess:   { view: true, edit: true, delete: true },
    aiSupportAccess: { view: true, edit: true, delete: true },
    settingsAccess:  { view: true, edit: true, delete: true },
    employees:       { view: true, edit: true, delete: true },
    taxReport:       { view: true, edit: true, delete: true },
    insights:        { view: true, edit: true, delete: true },
    addNewLead:      { view: true, edit: true, delete: true },
    scheduleMeeting: { view: true, edit: true, delete: true },
    generateReport:  { view: true, edit: true, delete: true },
  }

  const staffUsers = await User.insertMany([
    { name: 'Admin User',       email: 'admin@flyweis.test',        password: hash('Admin@1234'),   role: 'admin',        phone: '+19001001001', department: 'Management',   isActive: true, permissions: allPerms },
    { name: 'Sarah Mitchell',   email: 'sales@flyweis.test',        password: hash('Sales@1234'),   role: 'sales',        phone: '+19001001002', department: 'Sales',        isActive: true, permissions: allPerms },
    { name: 'James Kowalski',   email: 'plant@flyweis.test',        password: hash('Plant@1234'),   role: 'plant',        phone: '+19001001003', department: 'Plant',        isActive: true },
    { name: 'Daniel Torres',    email: 'account@flyweis.test',      password: hash('Account@1234'), role: 'account',      phone: '+19001001004', department: 'Finance',      isActive: true },
    { name: 'Emily Carter',     email: 'construction@flyweis.test', password: hash('Const@1234'),   role: 'construction', phone: '+19001001005', department: 'Construction', isActive: true },
  ])

  const admin     = staffUsers[0]
  const salesUser = staffUsers[1]
  console.log('👤 Staff users created:', staffUsers.map(u => u.email).join(', '))

  // ── CUSTOMERS ─────────────────────────────────────────────────────────────
  const custDefs = [
    { firstName: 'John',   lastName: 'Anderson',  email: 'john.anderson@flyweis.test',   phone: { number: '5551001001', countryCode: '+1' }, company: 'Anderson Steel Works',       source: 'manual'          },
    { firstName: 'Maria',  lastName: 'Rodriguez', email: 'maria.rodriguez@flyweis.test', phone: { number: '5551001002', countryCode: '+1' }, company: 'Rodriguez Construction LLC', source: 'customer_portal' },
    { firstName: 'David',  lastName: 'Chen',      email: 'david.chen@flyweis.test',      phone: { number: '5551001003', countryCode: '+1' }, company: 'Pacific Build Co.',         source: 'chat'            },
    { firstName: 'Rachel', lastName: 'Thompson',  email: 'rachel.thompson@flyweis.test', phone: { number: '5551001004', countryCode: '+1' }, company: 'Thompson Builders',         source: 'manual'          },
  ]
  const customers = []
  for (const def of custDefs) {
    const customerId = await generateCustomerId()
    customers.push(await Customer.create({ ...def, customerId, password: hash('Customer@1234'), isActive: true }))
  }
  console.log('🏢 Customers created:', customers.map(c => c.email).join(', '))

  // ── LEADS ─────────────────────────────────────────────────────────────────
  const leadDefs = [
    {
      customerId: customers[0]._id,
      buildingType: 'Commercial Warehouse', location: 'Austin, TX',
      roofStyle: 'Gable', sqft: '12000', width: 80, length: 150,
      lifecycleStatus: 'proposal_sent', temperature: 'hot',
      requirements: 'Steel warehouse with 30ft clearance, 4 roll-up doors',
      source: 'manual',
      assignedEmployee: { employeeId: salesUser._id, method: 'manual', assignedBy: admin._id },
    },
    {
      customerId: customers[1]._id,
      buildingType: 'Industrial Facility', location: 'Houston, TX',
      roofStyle: 'Single Slope', sqft: '25000', width: 120, length: 200,
      lifecycleStatus: 'negotiation', temperature: 'warm',
      requirements: 'Large industrial facility, heavy crane support required',
      source: 'customer_portal',
      assignedEmployee: { employeeId: salesUser._id, method: 'manual', assignedBy: admin._id },
    },
    {
      customerId: customers[2]._id,
      buildingType: 'Agricultural Storage', location: 'Phoenix, AZ',
      roofStyle: 'Gambrel', sqft: '8000', width: 60, length: 120,
      lifecycleStatus: 'requirements_gathered', temperature: 'warm',
      requirements: 'Farm storage, ventilation panels needed',
      source: 'chat',
      assignedEmployee: { employeeId: salesUser._id, method: 'manual', assignedBy: admin._id },
    },
    {
      customerId: customers[3]._id,
      buildingType: 'Retail Showroom', location: 'Dallas, TX',
      roofStyle: 'Hip', sqft: '5000', width: 50, length: 100,
      lifecycleStatus: 'initial_contact', temperature: 'cold',
      requirements: 'Modern retail space with glass facade',
      source: 'manual',
      assignedEmployee: { employeeId: salesUser._id, method: 'manual', assignedBy: admin._id },
    },
    {
      customerId: customers[0]._id,
      buildingType: 'Distribution Center', location: 'San Antonio, TX',
      roofStyle: 'Gable', sqft: '40000', width: 200, length: 200,
      lifecycleStatus: 'deal_closed', temperature: 'hot',
      requirements: 'High-volume distribution center, dock levelers x12',
      source: 'manual',
      assignedEmployee: { employeeId: salesUser._id, method: 'manual', assignedBy: admin._id },
    },
  ]

  const leads = []
  for (const def of leadDefs) {
    leads.push(await Lead.create(def))
  }
  console.log('📋 Leads created:', leads.length)

  // ── BUILDINGS ─────────────────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    await Building.create({
      leadId: leads[i]._id,
      customerId: customers[i]._id,
      buildingNumber: 1,
      createdBy: salesUser._id,
    })
  }
  console.log('🏗 Buildings created for first 3 leads')

  // ── FOLLOW-UPS ────────────────────────────────────────────────────────────
  const d1 = new Date(); d1.setDate(d1.getDate() + 1)
  const d7 = new Date(); d7.setDate(d7.getDate() + 7)
  const d3 = new Date(); d3.setDate(d3.getDate() + 3)

  await FollowUp.insertMany([
    { leadId: leads[0]._id, customerId: customers[0]._id, assignedTo: salesUser._id, createdBy: salesUser._id, followUpDate: d1, modeOfContact: 'call',    notes: 'Follow up on proposal — client wants to discuss roof clearance', status: 'pending' },
    { leadId: leads[1]._id, customerId: customers[1]._id, assignedTo: salesUser._id, createdBy: salesUser._id, followUpDate: d7, modeOfContact: 'email',   notes: 'Send revised quote for crane support specification',              status: 'pending' },
    { leadId: leads[2]._id, customerId: customers[2]._id, assignedTo: salesUser._id, createdBy: salesUser._id, followUpDate: d3, modeOfContact: 'meeting', notes: 'Virtual demo of ventilation panel options',                       status: 'pending' },
  ])
  console.log('📞 Follow-ups created')

  // ── MEETINGS ──────────────────────────────────────────────────────────────
  await Meeting.insertMany([
    { customerId: customers[0]._id, leadId: leads[0]._id, createdBy: salesUser._id, title: 'Warehouse Design Review',       meetingTime: d1, mode: 'online',  meetingLink: 'https://meet.google.com/abc-defg-hij', status: 'scheduled' },
    { customerId: customers[1]._id, leadId: leads[1]._id, createdBy: salesUser._id, title: 'Industrial Facility Site Visit', meetingTime: d7, mode: 'offline',                                                    status: 'scheduled' },
  ])
  console.log('📅 Meetings created')

  // ── FREIGHT CARRIERS ─────────────────────────────────────────────────────
  const carriers = await FreightCarrier.insertMany([
    { carrierCode: 'FC-0001', carrierName: 'Swift Steel Haulers',    email: 'swift@flyweis.test',   phone: '5559001001', contactName: 'Mike Reynolds',  serviceType: 'Flatbed', serviceArea: 'Texas, Oklahoma', status: 'active' },
    { carrierCode: 'FC-0002', carrierName: 'TexTrans Logistics',     email: 'textrans@flyweis.test', phone: '5559001002', contactName: 'Laura Kim',       serviceType: 'Lowboy',  serviceArea: 'Texas, Arizona',  status: 'active' },
    { carrierCode: 'FC-0003', carrierName: 'Pacific Freight Lines',  email: 'pacific@flyweis.test',  phone: '5559001003', contactName: 'Carlos Ruiz',     serviceType: 'Flatbed', serviceArea: 'Arizona, California', status: 'active' },
  ])
  console.log('🚛 Freight carriers created')

  // ── PO ORDERS (approved) — links leads to plant ───────────────────────────
  const fakeInvoiceId = new mongoose.Types.ObjectId()
  const plantUser = staffUsers[2] // James Kowalski — plant role
  const poOrders = await POOrder.insertMany([
    { leadId: leads[0]._id, customerId: customers[0]._id, raisedBy: admin._id, assignedTo: plantUser._id, invoiceId: fakeInvoiceId, poNumber: 'PO-0001', status: 'approved' },
    { leadId: leads[1]._id, customerId: customers[1]._id, raisedBy: admin._id, assignedTo: plantUser._id, invoiceId: fakeInvoiceId, poNumber: 'PO-0002', status: 'approved' },
    { leadId: leads[4]._id, customerId: customers[0]._id, raisedBy: admin._id, assignedTo: plantUser._id, invoiceId: fakeInvoiceId, poNumber: 'PO-0003', status: 'approved' },
  ])
  console.log('📑 PO Orders created (approved)')

  // ── DELIVERIES ────────────────────────────────────────────────────────────
  const now = new Date()
  const d = (offsetDays) => { const x = new Date(now); x.setDate(x.getDate() + offsetDays); return x }

  const deliveryDocs = await Delivery.insertMany([
    {
      leadId: leads[0]._id, deliveryNumber: 'DEL-0001', status: 'bidding_sent',
      description: 'Steel frame components for warehouse', loadDescription: 'Structural steel beams & columns',
      loadWeight: 24000, materialType: 'Structural Steel', packageCount: 48,
      loadingEquipment: ['Forklift', 'Crane'],
      pickupLocation: 'Austin Plant, TX', pickupDate: d(3), pickupTime: '08:00',
      deliveryLocation: 'Anderson Steel Works, Austin TX', deliveryDate: d(5),
      bidDeadline: d(2),
      timings: '08:00 - 16:00', specialRequirements: '30ft clearance needed at delivery site',
    },
    {
      leadId: leads[1]._id, deliveryNumber: 'DEL-0002', status: 'carrier_selected',
      description: 'Industrial facility steel — phase 1', loadDescription: 'Heavy crane support beams',
      loadWeight: 38000, materialType: 'Heavy Steel', packageCount: 60,
      loadingEquipment: ['Crane', 'Rigging'],
      pickupLocation: 'Houston Yard, TX', pickupDate: d(7), pickupTime: '07:00',
      deliveryLocation: 'Rodriguez Construction, Houston TX', deliveryDate: d(9),
      bidDeadline: d(1),
      timings: '07:00 - 15:00', specialRequirements: 'Heavy crane required at site',
    },
    {
      leadId: leads[4]._id, deliveryNumber: 'DEL-0003', status: 'in_transit',
      description: 'Distribution center — main frame', loadDescription: 'Dock levelers & steel frame',
      loadWeight: 52000, materialType: 'Structural Steel', packageCount: 96,
      loadingEquipment: ['Forklift', 'Crane'],
      pickupLocation: 'San Antonio Plant, TX', pickupDate: d(-2), pickupTime: '06:00',
      deliveryLocation: 'Distribution Center, San Antonio TX', deliveryDate: d(1),
      bidDeadline: d(-5),
      timings: '06:00 - 14:00',
    },
    {
      leadId: leads[0]._id, deliveryNumber: 'DEL-0004', status: 'scheduled',
      description: 'Warehouse roof panels', loadDescription: 'Gable roof panel sheets',
      loadWeight: 8000, materialType: 'Steel Panels', packageCount: 24,
      loadingEquipment: ['Forklift'],
      pickupLocation: 'Austin Plant, TX', pickupDate: d(10), pickupTime: '09:00',
      deliveryLocation: 'Anderson Steel Works, Austin TX', deliveryDate: d(12),
      bidDeadline: d(8),
      timings: '09:00 - 17:00',
    },
  ])
  console.log('📦 Deliveries created')

  // ── FREIGHT BIDS ──────────────────────────────────────────────────────────
  const crypto = require('crypto')
  const bids = []
  for (const delivery of deliveryDocs) {
    for (const carrier of carriers) {
      const isSelected = delivery.status === 'carrier_selected' && carrier._id.equals(carriers[0]._id)
      const status = isSelected ? 'selected' : (delivery.status === 'bidding_sent' ? 'sent' : 'submitted')
      const quotedAmount = 1800 + Math.floor(Math.random() * 3200)
      bids.push({
        deliveryId: delivery._id,
        carrierId: carrier._id,
        token: crypto.randomBytes(32).toString('hex'),
        status,
        quotedAmount: status === 'sent' ? null : quotedAmount,
        estimatedPickupDate: delivery.pickupDate,
        estimatedDeliveryDate: delivery.deliveryDate,
        carrierNotes: status === 'sent' ? '' : `Standard flatbed rate — includes fuel surcharge`,
        submittedAt: status !== 'sent' ? new Date() : null,
      })
    }
  }

  // Mark selected bid on DEL-0002
  const selectedBid = bids.find(b => b.deliveryId.equals(deliveryDocs[1]._id) && b.carrierId.equals(carriers[0]._id))
  if (selectedBid) selectedBid.status = 'selected'

  const savedBids = await FreightBid.insertMany(bids)

  // Link selected bid to delivery
  const del2selectedBid = savedBids.find(b => b.deliveryId.equals(deliveryDocs[1]._id) && b.carrierId.equals(carriers[0]._id))
  if (del2selectedBid) {
    await Delivery.findByIdAndUpdate(deliveryDocs[1]._id, { selectedCarrierBidId: del2selectedBid._id })
  }
  console.log('💰 Freight bids created')

  // ── PRINT CREDENTIALS ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('🎉  SEED COMPLETE — Login Credentials')
  console.log('═'.repeat(60))

  console.log('\n📌  STAFF LOGIN  →  POST /api/auth/login')
  console.log('─'.repeat(60))
  const staff = [
    ['Admin',        'admin@flyweis.test',        'Admin@1234',   'admin'],
    ['Sales',        'sales@flyweis.test',        'Sales@1234',   'sales'],
    ['Plant',        'plant@flyweis.test',        'Plant@1234',   'plant'],
    ['Account',      'account@flyweis.test',      'Account@1234', 'account'],
    ['Construction', 'construction@flyweis.test', 'Const@1234',   'construction'],
  ]
  staff.forEach(([name, email, pass, role]) => {
    console.log(`  ${name.padEnd(14)} ${email.padEnd(35)} ${pass.padEnd(14)} role: ${role}`)
  })

  console.log('\n📌  CUSTOMER LOGIN  →  POST /api/customer/auth/login')
  console.log('─'.repeat(60))
  const custs = [
    ['John Anderson',   'john.anderson@flyweis.test',   'Customer@1234', 'Anderson Steel Works'],
    ['Maria Rodriguez', 'maria.rodriguez@flyweis.test', 'Customer@1234', 'Rodriguez Construction LLC'],
    ['David Chen',      'david.chen@flyweis.test',      'Customer@1234', 'Pacific Build Co.'],
    ['Rachel Thompson', 'rachel.thompson@flyweis.test', 'Customer@1234', 'Thompson Builders'],
  ]
  custs.forEach(([name, email, pass, co]) => {
    console.log(`  ${name.padEnd(18)} ${email.padEnd(38)} ${pass}  (${co})`)
  })

  console.log('\n📌  MOCK DATA')
  console.log('─'.repeat(60))
  console.log('  • 5 Leads   — hot/warm/cold, various lifecycle stages')
  console.log('  • 3 Buildings')
  console.log('  • 3 Follow-ups (due in 1 / 3 / 7 days)')
  console.log('  • 2 Meetings')
  console.log('  • 3 PO Orders (approved) — links leads to plant user')
  console.log('  • 3 Freight Carriers')
  console.log('  • 4 Deliveries (bidding_sent, carrier_selected, in_transit, scheduled)')
  console.log('  • 12 Freight Bids')
  console.log('═'.repeat(60) + '\n')

  await mongoose.disconnect()
  process.exit(0)
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message)
  console.error(err)
  process.exit(1)
})
