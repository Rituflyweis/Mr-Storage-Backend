const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
require('dotenv').config()
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Invoice = require('../src/models/Invoice')
const User = require('../src/models/User')
const Building = require('../src/models/Building')
const ProjectStepDetail = require('../src/models/ProjectStepDetail')
const Milestone = require('../src/models/Milestone')
const DrawingDocument = require('../src/models/DrawingDocument')
const Delivery = require('../src/models/Delivery')
const MaterialRequest = require('../src/models/MaterialRequest')
const OrderQuotation = require('../src/models/OrderQuotation')
const WIPProfit = require('../src/models/WIPProfit')
const Expense = require('../src/models/Expense')
const ExpenseCategory = require('../src/models/ExpenseCategory')
const ProjectBudget = require('../src/models/ProjectBudget')
const generateCustomerId = require('../src/utils/generateCustomerId')

const CUSTOMERS = [
  { email: 'devcustomer1@example.com', firstName: 'Dev', lastName: 'CustomerOne', phone: '5551110001', project: 'Dev Warehouse One', location: 'Austin, TX' },
  { email: 'devcustomer2@example.com', firstName: 'Dev', lastName: 'CustomerTwo', phone: '5551110002', project: 'Dev Warehouse Two', location: 'Dallas, TX' },
]
const PASSWORD = 'Test@1234'

async function ensureCategories(staff) {
  const names = ['Vendor/Freight', 'Operations', 'Miscellaneous', 'Salaries', 'Marketing']
  const cats = []
  for (const name of names) {
    let cat = await ExpenseCategory.findOne({ name })
    if (!cat) cat = await ExpenseCategory.create({ name, createdBy: staff._id })
    cats.push(cat)
  }
  return cats
}

async function seedForCustomer(def, staff, categories) {
  console.log(`\n=== ${def.email} ===`)

  let customer = await Customer.findOne({ email: def.email })
  const hashed = await bcrypt.hash(PASSWORD, 12)
  if (!customer) {
    const customerId = await generateCustomerId()
    customer = await Customer.create({
      customerId, firstName: def.firstName, lastName: def.lastName, email: def.email,
      phone: { number: def.phone, countryCode: '+1' }, password: hashed, isActive: true, source: 'chat',
    })
    console.log('Created customer:', customer.email, customer.customerId)
  } else {
    customer.password = hashed
    await customer.save()
    console.log('Customer existed — password reset:', customer.email)
  }

  let lead = await Lead.findOne({ customerId: customer._id })
  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id, projectName: def.project, buildingType: 'Warehouse', location: def.location,
      quoteValue: 150000, lifecycleStatus: 'converted_to_po', isRaisedToPO: true, source: 'customer_portal',
      lifecycleHistory: [{ stage: 'converted_to_po', changedAt: new Date(), changedBy: null }],
    })
    console.log('Created lead:', lead.projectName, lead.jobId)
  } else if (!lead.isRaisedToPO) {
    lead.isRaisedToPO = true
    await lead.save()
  }

  if (!(await Invoice.findOne({ leadId: lead._id, status: 'paid' }))) {
    const depositAmount = Math.round(lead.quoteValue * 0.3)
    const invoice = await Invoice.create({
      leadId: lead._id, customerId: customer._id, createdBy: staff._id,
      invoiceNumber: `INV-DEV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      description: '30% deposit invoice (dev)', date: new Date(), totalAmount: depositAmount, status: 'paid',
    })
    console.log('Created paid invoice:', invoice.invoiceNumber, 'amount:', depositAmount)
  }

  if (await Building.countDocuments({ leadId: lead._id }) === 0) {
    await Building.create({ leadId: lead._id, customerId: customer._id, buildingNumber: 1, status: 'drawing_approved', createdBy: staff._id })
    await Building.create({ leadId: lead._id, customerId: customer._id, buildingNumber: 2, status: 'pending', createdBy: staff._id })
    console.log('Created 2 buildings')
  }

  if (!(await ProjectStepDetail.findOne({ leadId: lead._id, stepKey: 'fabrication' }))) {
    await ProjectStepDetail.create({
      leadId: lead._id, stepKey: 'fabrication', currentStage: 'Under Fabrication', completionPct: 55,
      expectedCompletion: new Date(Date.now() + 14 * 86400000), startedBy: staff.name,
      startedAt: new Date(Date.now() - 10 * 86400000), updatedBy: staff._id,
    })
    console.log('Created ProjectStepDetail')
  }

  if (await Milestone.countDocuments({ leadId: lead._id }) === 0) {
    await Milestone.create({ leadId: lead._id, title: 'Fabrication complete', status: 'in_progress', targetDate: new Date(Date.now() + 14 * 86400000), order: 1, createdBy: staff._id })
    await Milestone.create({ leadId: lead._id, title: 'Delivery scheduled', status: 'pending', targetDate: new Date(Date.now() + 25 * 86400000), order: 2, createdBy: staff._id })
    console.log('Created 2 milestones')
  }

  if (await DrawingDocument.countDocuments({ leadId: lead._id }) === 0) {
    const drawings = [
      { name: 'Foundation Plan.pdf', status: 'approved', documentType: 'structural', buildingLabel: 'Building A' },
      { name: 'Roof Structure.pdf', status: 'approved', documentType: 'structural', buildingLabel: 'Building A' },
      { name: 'Wall Elevation.pdf', status: 'pending', documentType: 'architectural', buildingLabel: 'Building B' },
      { name: 'Electrical Layout.pdf', status: 'under_review', documentType: 'specification', buildingLabel: 'Building B' },
      { name: 'HVAC Plan.pdf', status: 'rejected', documentType: 'other', buildingLabel: 'Building A', revisionNote: 'Please revise duct routing', revisionRequestedAt: new Date() },
    ]
    for (const d of drawings) {
      await DrawingDocument.create({
        leadId: lead._id, name: d.name, status: d.status, documentType: d.documentType, buildingLabel: d.buildingLabel,
        fileUrl: `https://mr-storage-project.s3.ap-south-1.amazonaws.com/documents/mock-${d.name.replace(/\s+/g, '-').toLowerCase()}`,
        fileType: 'application/pdf', uploadedBy: staff._id, revisionNote: d.revisionNote || '', revisionRequestedAt: d.revisionRequestedAt || null,
      })
    }
    console.log('Created 5 drawings')
  }

  if (await Delivery.countDocuments({ leadId: lead._id }) === 0) {
    const deliveries = [
      { deliveryNumber: `DEV-DEL-${Date.now()}-1`, status: 'in_transit', deliveryDate: new Date(Date.now() + 3 * 86400000), loadDescription: 'Primary structural steel frame', loadWeight: 8500 },
      { deliveryNumber: `DEV-DEL-${Date.now()}-2`, status: 'scheduled', deliveryDate: new Date(Date.now() + 10 * 86400000), loadDescription: 'Roof panels and trim', loadWeight: 4200 },
      { deliveryNumber: `DEV-DEL-${Date.now()}-3`, status: 'delivered', deliveryDate: new Date(Date.now() - 5 * 86400000), loadDescription: 'Foundation anchor bolts', loadWeight: 1200 },
    ]
    for (const d of deliveries) {
      await Delivery.create({
        leadId: lead._id, deliveryNumber: d.deliveryNumber, status: d.status, deliveryDate: d.deliveryDate,
        loadDescription: d.loadDescription, loadWeight: d.loadWeight, deliveryLocation: def.location,
        receivingPoc: `${def.firstName} ${def.lastName}`, pickupContactPhone: '+1' + def.phone,
        specialRequirements: '20-ton crane required', timings: '8:00 AM - 12:00 PM',
      })
    }
    console.log('Created 3 deliveries')
  }

  if (await MaterialRequest.countDocuments({ leadId: lead._id }) === 0) {
    const suffix = Date.now().toString().slice(-6)
    const genId = (n) => `MR-DEV-${suffix}${n}`

    const mr1 = await MaterialRequest.create({
      requestId: genId(1), leadId: lead._id, buildingLabel: 'Building A', source: 'customer', requestedByCustomer: customer._id, status: 'pending',
      requestedItems: [{ name: 'Black 26ga', quantity: 30, unit: 'ft', lengthFeet: 24, color: 'Black' }],
      requiredBy: new Date(Date.now() + 20 * 86400000), priority: 'medium',
    })

    const mr2 = await MaterialRequest.create({
      requestId: genId(2), leadId: lead._id, buildingLabel: 'Building A', source: 'customer', requestedByCustomer: customer._id, status: 'pending',
      requestedItems: [{ name: 'Silver 24ga', quantity: 20, unit: 'ft', lengthFeet: 16, color: 'Silver' }],
      requiredBy: new Date(Date.now() + 18 * 86400000), priority: 'medium',
    })
    await OrderQuotation.create({
      quotationNumber: `QT-DEV-${suffix}2`, orderId: mr2._id, leadId: lead._id, customerId: customer._id, buildingLabel: 'Building A', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Silver 24ga', lengthFeet: 16, quantity: 20, color: 'Silver', unitPrice: 30, amount: 600 }],
      subtotal: 600, tax: 30, freight: 20, totalValue: 650, status: 'sent', createdBy: staff._id,
    })

    const mr3 = await MaterialRequest.create({
      requestId: genId(3), leadId: lead._id, buildingLabel: 'Building B', source: 'customer', requestedByCustomer: customer._id, status: 'approved',
      requestedItems: [{ name: 'Galvanized 24ga', quantity: 25, unit: 'ft', lengthFeet: 20, color: 'Silver', deliveryStatus: 'pending' }],
      requiredBy: new Date(Date.now() + 15 * 86400000), priority: 'high',
    })
    await OrderQuotation.create({
      quotationNumber: `QT-DEV-${suffix}3`, orderId: mr3._id, leadId: lead._id, customerId: customer._id, buildingLabel: 'Building B', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Galvanized 24ga', lengthFeet: 20, quantity: 25, color: 'Silver', unitPrice: 28, amount: 700 }],
      subtotal: 700, tax: 35, freight: 25, totalValue: 760, status: 'approved', respondedAt: new Date(), createdBy: staff._id,
    })

    const mr4 = await MaterialRequest.create({
      requestId: genId(4), leadId: lead._id, buildingLabel: 'Building A', source: 'customer', requestedByCustomer: customer._id, status: 'fulfilled',
      requestedItems: [{ name: 'Black 26ga', quantity: 18, unit: 'ft', lengthFeet: 12, color: 'Black', deliveryStatus: 'delivered', deliveryReference: 'DEV-DEL-1', deliveredAt: new Date(Date.now() - 5 * 86400000) }],
      requiredBy: new Date(Date.now() - 8 * 86400000), priority: 'medium', totalAmount: 500,
    })
    await OrderQuotation.create({
      quotationNumber: `QT-DEV-${suffix}4`, orderId: mr4._id, leadId: lead._id, customerId: customer._id, buildingLabel: 'Building A', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Black 26ga', lengthFeet: 12, quantity: 18, color: 'Black', unitPrice: 25, amount: 450 }],
      subtotal: 450, tax: 30, freight: 20, totalValue: 500, status: 'approved', respondedAt: new Date(Date.now() - 6 * 86400000), createdBy: staff._id,
    })

    const mr5 = await MaterialRequest.create({
      requestId: genId(5), leadId: lead._id, buildingLabel: 'Building B', source: 'customer', requestedByCustomer: customer._id, status: 'rejected',
      requestedItems: [{ name: 'Galvanized 24ga', quantity: 15, unit: 'ft', lengthFeet: 12, color: 'Silver' }],
      requiredBy: new Date(Date.now() + 10 * 86400000), priority: 'low',
    })
    await OrderQuotation.create({
      quotationNumber: `QT-DEV-${suffix}5`, orderId: mr5._id, leadId: lead._id, customerId: customer._id, buildingLabel: 'Building B', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Galvanized 24ga', lengthFeet: 12, quantity: 15, color: 'Silver', unitPrice: 22, amount: 330 }],
      subtotal: 330, tax: 15, freight: 10, totalValue: 355, status: 'rejected', respondedAt: new Date(), rejectionReason: 'Price too high', createdBy: staff._id,
    })

    await MaterialRequest.create({
      requestId: genId(6), leadId: lead._id, buildingLabel: 'Building A', source: 'customer', requestedByCustomer: customer._id, status: 'cancelled',
      requestedItems: [{ name: 'Black 26ga', quantity: 10, unit: 'ft', lengthFeet: 8, color: 'Black' }],
      requiredBy: new Date(Date.now() + 5 * 86400000), priority: 'low',
    })

    console.log('Created 6 material requests covering all stages')
  }

  if (!(await WIPProfit.findOne({ leadId: lead._id }))) {
    const wip = await WIPProfit.create({
      leadId: lead._id, orderValue: lead.quoteValue, currentCost: Math.round(lead.quoteValue * 0.7),
      depositPaid: 45000, progressPaid: 0, finalPaid: 0, outstanding: lead.quoteValue - 45000,
      wipProfit: 45000 - Math.round(lead.quoteValue * 0.7),
      marginPct: Math.round(((45000 - lead.quoteValue * 0.7) / lead.quoteValue) * 100),
      status: 'in_progress', createdBy: staff._id,
    })
    wip.payments.push({ payerName: `${def.firstName} ${def.lastName}`, paymentType: 'deposit', amount: 45000, paymentDate: new Date(Date.now() - 10 * 86400000), transactionId: `DEV-TXN-${Date.now()}`, remarks: 'Initial 30% deposit', recordedBy: staff._id })
    await wip.save()
    console.log('Created WIP profit entry')
  }

  if (await Expense.countDocuments({ leadId: lead._id }) === 0) {
    const count = await Expense.countDocuments()
    const rows = [
      { category: categories[0].name, amount: 1850.5, description: 'Vendor freight charge' },
      { category: categories[1].name, amount: 980, description: 'Site operations cost' },
      { category: categories[2].name, amount: 275, description: 'Misc site expenses' },
    ]
    for (let i = 0; i < rows.length; i++) {
      await Expense.create({
        expenseId: `EXP-DEV${String(count + i + 1).padStart(5, '0')}`, category: rows[i].category, date: new Date(Date.now() - i * 3 * 86400000),
        amount: rows[i].amount, description: rows[i].description, leadId: lead._id, buildingLabel: 'Building A',
        paymentMethod: 'bank_transfer', status: 'paid', createdBy: staff._id,
      })
    }
    console.log('Created 3 expenses')
  }

  if (!(await ProjectBudget.findOne({ leadId: lead._id }))) {
    await ProjectBudget.create({
      leadId: lead._id, materialBudget: 60000, logisticBudget: 20000, productionBudget: 30000,
      shipperBudget: 8000, otherCost: 4000, totalBudget: 122000, createdBy: staff._id,
    })
    console.log('Created project budget')
  }

  return { email: def.email, password: PASSWORD, customerId: customer.customerId, leadId: lead._id.toString(), jobId: lead.jobId }
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const staff = await User.findOne()
  if (!staff) { console.log('No User exists in this DB'); process.exit(1) }

  const categories = await ensureCategories(staff)

  const results = []
  for (const def of CUSTOMERS) {
    results.push(await seedForCustomer(def, staff, categories))
  }

  console.log('\n\n=== SUMMARY ===')
  results.forEach(r => console.log(JSON.stringify(r, null, 2)))
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1) })
