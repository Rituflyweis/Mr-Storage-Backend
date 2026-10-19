/**
 * Full AvaTax lifecycle + orchestrator commit/void/adjust + Returns sync probe.
 * Uses production AvaTax when AVATAX_ENV=production (matches Steel Investments creds).
 *
 * Run: TAX_ENGINE=avalara node scripts/test-avalara-full.js
 */
require('dotenv').config()

const mongoose = require('mongoose')
const avatax = require('../src/services/avalara/avataxClient')
const {
  getCompanyCode,
  getAvalaraEnv,
  isAvalaraConfigured,
  getActiveTaxProvider,
} = require('../src/config/taxEngine')
const { getShipFromTaxReadiness } = require('../src/utils/avalaraShipFrom.util')
const returnsClient = require('../src/services/avalara/returnsGraphqlClient')
const taxOrchestrator = require('../src/services/tax/taxOrchestrator.service')
const taxSync = require('../src/services/tax/taxSync.service')

const ok = (label, detail = '') => console.log(`  ✓ ${label}${detail ? `: ${detail}` : ''}`)
const warn = (label, detail = '') => console.log(`  ⚠ ${label}${detail ? `: ${detail}` : ''}`)
const fail = (label, err) => {
  console.error(`  ✗ ${label}:`, err?.message || err)
  process.exitCode = 1
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const iaShipTo = {
  line1: '100 Main St',
  city: 'Des Moines',
  state: 'IA',
  postalCode: '50309',
  country: 'US',
}

async function testRestCommitVoidAdjust() {
  console.log('\n--- AvaTax REST: create → commit → adjust → void ---\n')
  const shipFrom = getShipFromTaxReadiness({}).address
  const companyCode = getCompanyCode()
  const code = `E2E-REST-${Date.now()}`
  const baseModel = {
    lines: [{ number: '1', quantity: 1, amount: 1000, taxCode: 'P0000000', description: 'Steel materials' }],
    type: 'SalesInvoice',
    companyCode,
    date: new Date().toISOString().slice(0, 10),
    customerCode: 'E2E-TEST',
    code,
    currencyCode: 'USD',
    commit: false,
    addresses: {
      shipFrom: avatax.toAvaAddress(shipFrom),
      shipTo: avatax.toAvaAddress(iaShipTo),
    },
    description: 'Mr Storage Avalara full test (REST)',
  }

  const saved = await avatax.createTransaction(baseModel)
  ok('Create (Saved)', `tax=$${saved.totalTax} code=${code}`)

  await avatax.commitTransaction(companyCode, code)
  ok('Commit', 'document committed in AvaTax')

  const adjustCode = `${code}-REV`
  const adjusted = await avatax.adjustTransaction(companyCode, code, {
    adjustmentReason: 'PriceAdjusted',
    adjustmentDescription: 'E2E price decrease',
    newTransaction: {
      type: baseModel.type,
      companyCode,
      date: baseModel.date,
      customerCode: baseModel.customerCode,
      code: adjustCode,
      currencyCode: 'USD',
      commit: false,
      lines: [{ number: '1', quantity: 1, amount: 800, taxCode: 'P0000000', description: 'Steel materials' }],
      addresses: baseModel.addresses,
    },
  })
  ok('Adjust', `tax=$${adjusted.totalTax} status=${adjusted.status} code=${adjusted.code}`)

  const docCode = adjusted.code || code
  if (adjusted.status === 'Saved') {
    await avatax.commitTransaction(companyCode, docCode)
    ok('Commit adjusted doc', docCode)
  }

  await avatax.voidTransaction(companyCode, docCode, 'DocVoided')
  ok('Void', docCode)
}

async function testOrchestratorFlow() {
  console.log('\n--- Orchestrator: calculate → commitInvoiceTax → adjust → void ---\n')
  const Lead = require('../src/models/Lead')
  const Invoice = require('../src/models/Invoice')
  const User = require('../src/models/User')

  const actor = await User.findOne({ role: { $in: ['admin', 'account'] } }).select('_id').lean()
  if (!actor) throw new Error('No admin/account user in DB for test invoice')

  let lead = await Lead.findOne().sort({ updatedAt: -1 })
  if (!lead) throw new Error('No lead in DB')
  lead.installAddress = {
    line1: iaShipTo.line1,
    city: iaShipTo.city,
    state: iaShipTo.state,
    postalCode: iaShipTo.postalCode,
    country: iaShipTo.country,
  }
  lead.state = iaShipTo.state
  lead.city = iaShipTo.city
  lead.pincode = iaShipTo.postalCode
  await lead.save()

  const invoice = await Invoice.create({
    leadId: lead._id,
    invoiceType: 'customer',
    status: 'draft',
    revision: 1,
    invoiceNumber: `AVL-TEST-${Date.now()}`,
    subtotal: 1000,
    totalAmount: 1000,
    tax: 0,
    lineItems: [
      {
        description: 'Structural steel package',
        items: ['frame', 'beam'],
        category: 'Structure',
        quantity: 1,
        rate: 1000,
        total: 1000,
      },
    ],
    createdBy: actor._id,
  })

  const calc = await taxOrchestrator.calculateInvoiceTax(invoice, { lead: lead.toObject() })
  if (calc.skipped) throw new Error(`calculate skipped: ${calc.error || calc.reason}`)
  await invoice.save()
  ok(
    'calculateInvoiceTax',
    `tax=$${invoice.tax} testOnly=${invoice.avalara?.testOnly} status=${invoice.avalara?.documentStatus}`
  )

  const commitRes = await taxOrchestrator.commitInvoiceTax(invoice._id)
  if (commitRes.skipped) throw new Error(`commit skipped: ${commitRes.error || commitRes.reason}`)
  let inv = await Invoice.findById(invoice._id)
  ok(
    'commitInvoiceTax',
    `documentStatus=${inv.avalara?.documentStatus} taxCollected=$${inv.taxCollected}`
  )

  invoice.lineItems[0].total = 800
  invoice.lineItems[0].rate = 800
  invoice.subtotal = 800
  invoice.markModified('lineItems')
  await invoice.save()

  const adj = await taxOrchestrator.adjustInvoiceTax(invoice._id, {
    action: 'adjust',
    reason: 'E2E orchestrator adjust',
  })
  if (adj.skipped) throw new Error(`adjust skipped: ${adj.error || adj.reason}`)
  inv = await Invoice.findById(invoice._id)
  ok('adjustInvoiceTax', `tax=$${inv.tax} taxCollected=$${inv.taxCollected}`)

  const voidRes = await taxOrchestrator.adjustInvoiceTax(invoice._id, { action: 'void', reason: 'E2E cleanup' })
  if (voidRes.skipped) throw new Error('void skipped')
  inv = await Invoice.findById(invoice._id)
  ok('voidInvoiceTax (via adjust)', `documentStatus=${inv.avalara?.documentStatus}`)

  invoice.status = 'cancelled'
  await invoice.save()
}

async function testReturnsSync(returnsCompanyId) {
  console.log('\n--- Returns: OAuth + listFilings + syncTaxData ---\n')
  if (!returnsCompanyId) {
    warn('Returns', 'No AvaTax company id — skip')
    return
  }
  process.env.AVALARA_COMPANY_ID = String(returnsCompanyId)
  ok('AVALARA_COMPANY_ID (runtime)', returnsCompanyId)

  if (!returnsClient.isReturnsConfigured()) {
    warn('Returns config', 'isReturnsConfigured false')
    return
  }

  let returnsOk = false
  try {
    await returnsClient.fetchAccessToken()
    ok('Returns OAuth token')
    returnsOk = true
  } catch (e) {
    fail('Returns OAuth', e)
    warn(
      'Returns OAuth hint',
      'Managed Returns often needs separate OAuth client credentials (AVALARA_RETURNS_CLIENT_ID/SECRET), not AvaTax account+license. Set AVALARA_AUTH_URL / AVALARA_RETURNS_API_URL for production if onboarded.'
    )
  }

  if (returnsOk) {
    try {
      const filings = await returnsClient.listFilings(returnsCompanyId)
      if (filings === null) warn('listFilings', 'query unsupported or error (null)')
      else ok('listFilings', `${filings.length} row(s)`)
    } catch (e) {
      fail('listFilings', e)
    }
  }

  const sync = await taxSync.syncTaxData()
  ok('syncTaxData (invoice rollup if Returns unavailable)', JSON.stringify(sync))
}

async function main() {
  console.log('\n=== Avalara full test ===')
  console.log('Provider:', getActiveTaxProvider(), '| AvaTax env:', getAvalaraEnv())
  if (!isAvalaraConfigured()) {
    fail('Config', new Error('Missing AVATAX_* / company code'))
    return
  }
  if (getActiveTaxProvider() !== 'avalara') {
    warn('TAX_ENGINE', 'Set TAX_ENGINE=avalara for orchestrator tests (continuing REST either way)')
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) throw new Error('MONGO_URI required for orchestrator tests')

  let returnsCompanyId = process.env.AVALARA_COMPANY_ID
  try {
    const companies = await avatax.listCompanies({ top: 3 })
    if (companies[0]?.id) returnsCompanyId = returnsCompanyId || String(companies[0].id)
  } catch (e) {
    fail('listCompanies', e)
  }

  try {
    await testRestCommitVoidAdjust()
  } catch (e) {
    fail('REST lifecycle', e)
  }

  await sleep(15000)

  await mongoose.connect(uri)
  try {
    if (getActiveTaxProvider() === 'avalara') {
      await testOrchestratorFlow()
    } else {
      warn('Orchestrator', 'skipped (TAX_ENGINE != avalara)')
    }
    await testReturnsSync(returnsCompanyId)
  } finally {
    await mongoose.disconnect()
  }

  console.log('\n=== Full test finished (exit code', process.exitCode || 0, ') ===\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
