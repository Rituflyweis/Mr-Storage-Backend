const mongoose = require('mongoose')
require('dotenv').config()
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
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

async function run() {
  await mongoose.connect(process.env.MONGO_URI)

  const customer = await Customer.findOne({ email: 'customer1@example.com' })
  if (!customer) { console.log('customer1@example.com not found'); process.exit(1) }
  const lead = await Lead.findOne({ customerId: customer._id })
  if (!lead) { console.log('No lead for customer1'); process.exit(1) }
  const staff = await User.findOne()
  if (!staff) { console.log('No User exists'); process.exit(1) }

  console.log('Using lead:', lead.projectName, lead.jobId, lead._id.toString())

  // 1. Building
  const buildingCount = await Building.countDocuments({ leadId: lead._id })
  if (buildingCount === 0) {
    await Building.create({ leadId: lead._id, customerId: customer._id, buildingNumber: 1, status: 'drawing_approved', createdBy: staff._id })
    await Building.create({ leadId: lead._id, customerId: customer._id, buildingNumber: 2, status: 'pending', createdBy: staff._id })
    console.log('Created 2 buildings')
  }

  // 2. ProjectStepDetail (current stage/progress)
  const stepExists = await ProjectStepDetail.findOne({ leadId: lead._id, stepKey: 'fabrication' })
  if (!stepExists) {
    await ProjectStepDetail.create({
      leadId: lead._id, stepKey: 'fabrication',
      currentStage: 'Under Fabrication', completionPct: 65,
      expectedCompletion: new Date(Date.now() + 14 * 86400000),
      startedBy: staff.name, startedAt: new Date(Date.now() - 10 * 86400000),
      updatedBy: staff._id,
    })
    console.log('Created ProjectStepDetail')
  }

  // 3. Milestone
  const milestoneCount = await Milestone.countDocuments({ leadId: lead._id })
  if (milestoneCount === 0) {
    await Milestone.create({ leadId: lead._id, title: 'Fabrication complete', status: 'in_progress', targetDate: new Date(Date.now() + 14 * 86400000), order: 1, createdBy: staff._id })
    await Milestone.create({ leadId: lead._id, title: 'Delivery scheduled', status: 'pending', targetDate: new Date(Date.now() + 25 * 86400000), order: 2, createdBy: staff._id })
    console.log('Created 2 milestones')
  }

  // 4. Drawings (mixed statuses)
  const drawingCount = await DrawingDocument.countDocuments({ leadId: lead._id })
  if (drawingCount === 0) {
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
        fileType: 'application/pdf', uploadedBy: staff._id,
        revisionNote: d.revisionNote || '', revisionRequestedAt: d.revisionRequestedAt || null,
      })
    }
    console.log('Created 5 drawings')
  }

  // 5. Deliveries (mixed statuses)
  const deliveryCount = await Delivery.countDocuments({ leadId: lead._id })
  if (deliveryCount === 0) {
    const deliveries = [
      { deliveryNumber: 'CUST-DEL-101', status: 'in_transit', deliveryDate: new Date(Date.now() + 3 * 86400000), loadDescription: 'Primary structural steel frame', loadWeight: 8500 },
      { deliveryNumber: 'CUST-DEL-102', status: 'scheduled', deliveryDate: new Date(Date.now() + 10 * 86400000), loadDescription: 'Roof panels and trim', loadWeight: 4200 },
      { deliveryNumber: 'CUST-DEL-103', status: 'delivered', deliveryDate: new Date(Date.now() - 5 * 86400000), loadDescription: 'Foundation anchor bolts', loadWeight: 1200 },
    ]
    for (const d of deliveries) {
      await Delivery.create({
        leadId: lead._id, deliveryNumber: d.deliveryNumber, status: d.status, deliveryDate: d.deliveryDate,
        loadDescription: d.loadDescription, loadWeight: d.loadWeight,
        deliveryLocation: lead.location || 'Austin, TX', receivingPoc: 'Test Customer', pickupContactPhone: '+15550001234',
        specialRequirements: '20-ton crane required', timings: '8:00 AM - 12:00 PM',
      })
    }
    console.log('Created 3 deliveries')
  }

  // 6. Material Requests across all 6 stages
  const mrCount = await MaterialRequest.countDocuments({ leadId: lead._id })
  if (mrCount === 0) {
    const genId = (n) => `MR-2026-MOCK${String(n).padStart(3, '0')}`

    // new_order
    const mr1 = await MaterialRequest.create({
      requestId: genId(1), leadId: lead._id, buildingLabel: 'Building A', source: 'customer',
      requestedByCustomer: customer._id, status: 'pending',
      requestedItems: [{ name: 'Black 26ga', quantity: 30, unit: 'ft', lengthFeet: 24, color: 'Black' }],
      requiredBy: new Date(Date.now() + 20 * 86400000), priority: 'medium',
    })

    // quotation_received
    const mr2 = await MaterialRequest.create({
      requestId: genId(2), leadId: lead._id, buildingLabel: 'Building A', source: 'customer',
      requestedByCustomer: customer._id, status: 'pending',
      requestedItems: [{ name: 'Silver 24ga', quantity: 20, unit: 'ft', lengthFeet: 16, color: 'Silver' }],
      requiredBy: new Date(Date.now() + 18 * 86400000), priority: 'medium',
    })
    await OrderQuotation.create({
      quotationNumber: `QT-MOCK-${Date.now()}-2`, orderId: mr2._id, leadId: lead._id, customerId: customer._id,
      buildingLabel: 'Building A', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Silver 24ga', lengthFeet: 16, quantity: 20, color: 'Silver', unitPrice: 30, amount: 600 }],
      subtotal: 600, tax: 30, freight: 20, totalValue: 650, status: 'sent', createdBy: staff._id,
    })

    // order_confirmed (quotation approved)
    const mr3 = await MaterialRequest.create({
      requestId: genId(3), leadId: lead._id, buildingLabel: 'Building B', source: 'customer',
      requestedByCustomer: customer._id, status: 'approved',
      requestedItems: [{ name: 'Galvanized 24ga', quantity: 25, unit: 'ft', lengthFeet: 20, color: 'Silver', deliveryStatus: 'pending' }],
      requiredBy: new Date(Date.now() + 15 * 86400000), priority: 'high',
    })
    await OrderQuotation.create({
      quotationNumber: `QT-MOCK-${Date.now()}-3`, orderId: mr3._id, leadId: lead._id, customerId: customer._id,
      buildingLabel: 'Building B', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Galvanized 24ga', lengthFeet: 20, quantity: 25, color: 'Silver', unitPrice: 28, amount: 700 }],
      subtotal: 700, tax: 35, freight: 25, totalValue: 760, status: 'approved', respondedAt: new Date(), createdBy: staff._id,
    })

    // completed (fulfilled)
    const mr4 = await MaterialRequest.create({
      requestId: genId(4), leadId: lead._id, buildingLabel: 'Building A', source: 'customer',
      requestedByCustomer: customer._id, status: 'fulfilled',
      requestedItems: [{ name: 'Black 26ga', quantity: 18, unit: 'ft', lengthFeet: 12, color: 'Black', deliveryStatus: 'delivered', deliveryReference: 'CUST-DEL-103', deliveredAt: new Date(Date.now() - 5 * 86400000) }],
      requiredBy: new Date(Date.now() - 8 * 86400000), priority: 'medium', totalAmount: 500,
    })
    await OrderQuotation.create({
      quotationNumber: `QT-MOCK-${Date.now()}-4`, orderId: mr4._id, leadId: lead._id, customerId: customer._id,
      buildingLabel: 'Building A', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Black 26ga', lengthFeet: 12, quantity: 18, color: 'Black', unitPrice: 25, amount: 450 }],
      subtotal: 450, tax: 30, freight: 20, totalValue: 500, status: 'approved', respondedAt: new Date(Date.now() - 6 * 86400000), createdBy: staff._id,
    })

    // rejected
    const mr5 = await MaterialRequest.create({
      requestId: genId(5), leadId: lead._id, buildingLabel: 'Building B', source: 'customer',
      requestedByCustomer: customer._id, status: 'rejected',
      requestedItems: [{ name: 'Galvanized 24ga', quantity: 15, unit: 'ft', lengthFeet: 12, color: 'Silver' }],
      requiredBy: new Date(Date.now() + 10 * 86400000), priority: 'low',
    })
    await OrderQuotation.create({
      quotationNumber: `QT-MOCK-${Date.now()}-5`, orderId: mr5._id, leadId: lead._id, customerId: customer._id,
      buildingLabel: 'Building B', sellerName: 'Mr Storage Steel',
      lineItems: [{ coilType: 'Galvanized 24ga', lengthFeet: 12, quantity: 15, color: 'Silver', unitPrice: 22, amount: 330 }],
      subtotal: 330, tax: 15, freight: 10, totalValue: 355, status: 'rejected', respondedAt: new Date(), rejectionReason: 'Price too high', createdBy: staff._id,
    })

    // cancelled
    await MaterialRequest.create({
      requestId: genId(6), leadId: lead._id, buildingLabel: 'Building A', source: 'customer',
      requestedByCustomer: customer._id, status: 'cancelled',
      requestedItems: [{ name: 'Black 26ga', quantity: 10, unit: 'ft', lengthFeet: 8, color: 'Black' }],
      requiredBy: new Date(Date.now() + 5 * 86400000), priority: 'low',
    })

    console.log('Created 6 material requests covering all stages (new_order, quotation_received, order_confirmed, completed, rejected, cancelled)')
  }

  // 7. WIP Profit
  const wipExists = await WIPProfit.findOne({ leadId: lead._id })
  if (!wipExists) {
    const wip = await WIPProfit.create({
      leadId: lead._id, orderValue: lead.quoteValue, currentCost: Math.round(lead.quoteValue * 0.7),
      depositPaid: 30000, progressPaid: 0, finalPaid: 0,
      outstanding: lead.quoteValue - 30000, wipProfit: 30000 - Math.round(lead.quoteValue * 0.7),
      marginPct: Math.round(((30000 - lead.quoteValue * 0.7) / lead.quoteValue) * 100),
      status: 'in_progress', createdBy: staff._id,
    })
    wip.payments.push({ payerName: customer.firstName, paymentType: 'deposit', amount: 30000, paymentDate: new Date(Date.now() - 10 * 86400000), transactionId: 'MOCK-TXN-001', remarks: 'Initial 30% deposit', recordedBy: staff._id })
    await wip.save()
    console.log('Created WIP profit entry')
  }

  // 8. Expenses (using existing categories)
  const expenseCount = await Expense.countDocuments({ leadId: lead._id })
  if (expenseCount === 0) {
    const categories = await ExpenseCategory.find({ isActive: true }).lean()
    if (categories.length) {
      const count = await Expense.countDocuments()
      const rows = [
        { category: categories[0]?.name || 'Vendor/Freight', amount: 1793.12, description: 'Vendor freight charge' },
        { category: categories[1]?.name || 'Operations', amount: 950, description: 'Site operations cost' },
        { category: categories[2]?.name || 'Miscellaneous', amount: 320, description: 'Misc site expenses' },
      ]
      for (let i = 0; i < rows.length; i++) {
        await Expense.create({
          expenseId: `EXP${String(count + i + 1).padStart(5, '0')}`, category: rows[i].category,
          date: new Date(Date.now() - i * 3 * 86400000), amount: rows[i].amount, description: rows[i].description,
          leadId: lead._id, buildingLabel: 'Building A', paymentMethod: 'bank_transfer', status: 'paid', createdBy: staff._id,
        })
      }
      console.log('Created 3 expenses')
    } else {
      console.log('No ExpenseCategory records exist — skipped expense seeding')
    }
  }

  // 9. Project Budget
  const budgetExists = await ProjectBudget.findOne({ leadId: lead._id })
  if (!budgetExists) {
    await ProjectBudget.create({
      leadId: lead._id, materialBudget: 40000, logisticBudget: 15000, productionBudget: 20000,
      shipperBudget: 5000, otherCost: 3000, totalBudget: 83000, createdBy: staff._id,
    })
    console.log('Created project budget')
  }

  console.log('\nDone. Mock data seeded for lead', lead.jobId, '(' + lead._id.toString() + ')')
  process.exit(0)
}

run().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1) })
