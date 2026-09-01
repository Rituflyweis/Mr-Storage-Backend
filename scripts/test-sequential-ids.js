#!/usr/bin/env node
/**
 * Verifies sequential ID generators handle out-of-order data (the customerId bug class).
 * Uses TEST- prefixed rows and cleans up after itself.
 *
 * Usage: node scripts/test-sequential-ids.js
 */
require('dotenv').config()
const mongoose = require('mongoose')

const TAG = `TEST-${Date.now()}`
let passed = 0
let failed = 0

const assert = (cond, msg) => {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${msg}`)
  } else {
    failed += 1
    console.error(`  ✗ ${msg}`)
  }
}

const runCase = async (name, fn) => {
  process.stdout.write(`\n${name}\n`)
  try {
    await fn()
  } catch (err) {
    failed += 1
    console.error(`  ✗ threw: ${err.message}`)
  }
}

async function main() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI required in .env')
    process.exit(1)
  }

  await mongoose.connect(uri)
  console.log('Connected to MongoDB')
  console.log(`Run tag: ${TAG}`)

  const Customer = require('../src/models/Customer')
  const Lead = require('../src/models/Lead')
  const Vendor = require('../src/models/Vendor')
  const FreightCarrier = require('../src/models/FreightCarrier')
  const Invoice = require('../src/models/Invoice')
  const Quotation = require('../src/models/Quotation')
  const Delivery = require('../src/models/Delivery')
  const BundlePlan = require('../src/models/BundlePlan')
  const PackingListPlan = require('../src/models/PackingListPlan')
  const MaterialRequest = require('../src/models/MaterialRequest')
  const OrderQuotation = require('../src/models/OrderQuotation')
  const Expense = require('../src/models/Expense')
  const PaymentApproval = require('../src/models/PaymentApproval')

  const generateCustomerId = require('../src/utils/generateCustomerId')
  const generateJobId = require('../src/utils/generateJobId')
  const generateVendorCode = require('../src/utils/generateVendorCode')
  const generateCarrierCode = require('../src/utils/generateCarrierCode')
  const generateInvoiceNumber = require('../src/utils/generateInvoiceNumber')
  const generateQuoteNumber = require('../src/utils/generateQuoteNumber')
  const generatePONumber = require('../src/utils/generatePONumber')
  const generateDeliveryNumber = require('../src/utils/generateDeliveryNumber')
  const generateBundlePlanNumber = require('../src/utils/generateBundlePlanNumber')
  const generatePackingListPlanNumber = require('../src/utils/generatePackingListPlanNumber')
  const generateMaterialRequestId = require('../src/utils/generateMaterialRequestId')
  const generateOrderQuotationNumber = require('../src/utils/generateOrderQuotationNumber')
  const generateExpenseId = require('../src/utils/generateExpenseId')
  const generatePaymentApprovalId = require('../src/utils/generatePaymentApprovalId')
  const { allocateSequentialId } = require('../src/utils/allocateSequentialId')

  const cleanup = []

  const track = (model, doc) => {
    cleanup.push({ model, id: doc._id })
    return doc
  }

  // ── Unit: allocateSequentialId out-of-order trap ───────────────────────────
  await runCase('allocateSequentialId — out-of-order suffixes', async () => {
    const field = `trapField_${TAG}`
    const Trap = mongoose.models.SequentialIdTrap || mongoose.model(
      'SequentialIdTrap',
      new mongoose.Schema({ [field]: String, createdAt: Date }, { timestamps: true, strict: false })
    )

    await Trap.create([
      { [field]: `TRAP-${TAG}-000050`, createdAt: new Date('2024-01-01') },
      { [field]: `TRAP-${TAG}-000003`, createdAt: new Date('2026-08-19') },
    ])

    const next = await allocateSequentialId({
      model: Trap,
      field,
      parsePattern: new RegExp(`^TRAP-${TAG}-(\\d+)$`),
      format: (n) => `TRAP-${TAG}-${String(n).padStart(6, '0')}`,
    })

    assert(next === `TRAP-${TAG}-000051`, `next is max+1 (got ${next})`)
    assert(next !== `TRAP-${TAG}-000004`, 'did not use newest-row+1 trap value')

    await Trap.deleteMany({ [field]: { $regex: `^TRAP-${TAG}-` } })
  })

  // ── Customer ID (real generator, trap with existing high CUS- ids) ───────────
  await runCase('generateCustomerId — skips taken next suffix', async () => {
    const high = `CUS-9${String(TAG).slice(-4).replace(/\D/g, '9').padStart(4, '0')}0`
    const low = `CUS-9${String(TAG).slice(-4).replace(/\D/g, '9').padStart(4, '1')}`

    track(Customer, await Customer.create({
      customerId: high,
      firstName: 'SeqTestHigh',
      email: `${TAG}-high@test.local`,
      phone: { number: '1000000001', countryCode: '+1' },
      password: 'x',
      createdAt: new Date('2024-01-01'),
    }))

    track(Customer, await Customer.create({
      customerId: low,
      firstName: 'SeqTestLow',
      email: `${TAG}-low@test.local`,
      phone: { number: '1000000002', countryCode: '+1' },
      password: 'x',
    }))

    const next = await generateCustomerId()
    const highNum = parseInt(high.split('-')[1], 10)
    const nextNum = parseInt(next.split('-')[1], 10)
    assert(nextNum > highNum, `next (${next}) > high trap (${high})`)
  })

  // ── Smoke: each generator returns a string matching expected pattern ───────
  const smokeTests = [
    ['generateJobId', generateJobId, /^PRO-\d{3,}$/],
    ['generateVendorCode', generateVendorCode, /^VND-\d{4,}$/],
    ['generateCarrierCode', generateCarrierCode, /^CAR-\d{4,}$/],
    ['generateInvoiceNumber', generateInvoiceNumber, /^INV-\d{4,}$/],
    ['generateQuoteNumber', generateQuoteNumber, /^QUO-\d{4,}$/],
    ['generatePONumber', generatePONumber, /^PO-\d{4,}$/],
    ['generateDeliveryNumber', generateDeliveryNumber, /^DEL-\d{4,}$/],
    ['generateBundlePlanNumber', generateBundlePlanNumber, /^BP-\d{4,}$/],
    ['generatePackingListPlanNumber', generatePackingListPlanNumber, /^PLP-\d{4,}$/],
    ['generateMaterialRequestId', generateMaterialRequestId, /^MR-\d{4}-\d{4,}$/],
    ['generateOrderQuotationNumber', generateOrderQuotationNumber, /^INV\/\d{4}\/\d{4,}$/],
    ['generateExpenseId', generateExpenseId, /^EXP\d{5,}$/],
    ['generatePaymentApprovalId', generatePaymentApprovalId, /^PR-\d{4}-\d{5,}$/],
  ]

  for (const [name, fn, pattern] of smokeTests) {
    await runCase(`${name} — smoke`, async () => {
      const id = await fn()
      assert(typeof id === 'string' && id.length > 0, `returns non-empty string: ${id}`)
      assert(pattern.test(id), `matches pattern: ${id}`)
    })
  }

  // ── Uniqueness: allocate then persist so second call advances ─────────────
  await runCase('generateDeliveryNumber — persists and advances', async () => {
    const a = await generateDeliveryNumber()
    track(Delivery, await Delivery.create({
      leadId: new mongoose.Types.ObjectId(),
      deliveryNumber: a,
      status: 'scheduled',
      deliveryDate: new Date(),
    }))
    const b = await generateDeliveryNumber()
    assert(a !== b, `consecutive ids differ after persist (${a} vs ${b})`)
  })

  // ── Lead pre-save hook uses generateJobId ──────────────────────────────────
  await runCase('Lead pre-save jobId assignment', async () => {
    const cust = track(Customer, await Customer.create({
      customerId: `CUS-T${String(Date.now()).slice(-8)}`,
      firstName: 'JobTest',
      email: `${TAG}-job@test.local`,
      phone: { number: '1000000099', countryCode: '+1' },
      password: 'x',
    }))

    const lead = track(Lead, await Lead.create({
      customerId: cust._id,
      projectName: 'Seq ID Test Lead',
      source: 'manual',
    }))

    assert(/^PRO-\d{3,}$/.test(lead.jobId || ''), `lead got jobId: ${lead.jobId}`)
  })

  // ── Module load sanity (controllers that import generators) ────────────────
  await runCase('Controller imports load', async () => {
    require('../src/controllers/admin/construction.controller')
    require('../src/controllers/admin/financial.controller')
    require('../src/controllers/construction/materialRequest.controller')
    require('../src/controllers/plant/delivery.controller')
    require('../src/controllers/plant/shipper.controller')
    require('../src/controllers/plant/bundlePlan.controller')
    require('../src/controllers/customerPortal.controller')
    assert(true, 'all affected controllers require without error')
  })

  // cleanup test rows
  for (const { model, id } of cleanup) {
    try {
      await model.findByIdAndDelete(id)
    } catch (_) { /* ignore */ }
  }

  await mongoose.disconnect()

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Passed: ${passed}  Failed: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
