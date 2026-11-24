/**
 * Compare tax snapshot for the same invoice under local vs avalara engines.
 * Run: node scripts/compare-tax-local-vs-avalara.js
 */
require('dotenv').config()

const mongoose = require('mongoose')
const { getActiveTaxProvider } = require('../src/config/taxEngine')

const loadOrchestrator = () => {
  delete require.cache[require.resolve('../src/config/taxEngine')]
  delete require.cache[require.resolve('../src/services/tax/taxOrchestrator.service')]
  return require('../src/services/tax/taxOrchestrator.service')
}

const SHUBHI_LIKE = {
  _id: new mongoose.Types.ObjectId(),
  invoiceType: 'customer',
  status: 'draft',
  revision: 1,
  date: new Date(),
  customerId: 'compare-test-customer',
  lineItems: [
    {
      description: 'Building materials (taxable)',
      quantity: 1,
      total: 69482,
      rate: 69482,
      category: 'materials',
    },
  ],
  subtotal: 69482,
  shipToAddress: {
    line1: '4526 Mayberry ST',
    city: 'Omaha',
    state: 'NE',
    postalCode: '68106',
    country: 'US',
  },
}

async function runEngine(engine) {
  process.env.TAX_ENGINE = engine
  delete require.cache[require.resolve('../src/config/taxEngine')]
  const te = require('../src/config/taxEngine')
  const provider = te.getActiveTaxProvider()

  const taxOrchestrator = loadOrchestrator()
  const invoice = JSON.parse(JSON.stringify(SHUBHI_LIKE))
  const result = await taxOrchestrator.calculateInvoiceTax(invoice, { lead: null })

  return {
    engine,
    activeProvider: provider,
    calc: result,
    invoiceTax: invoice.tax,
    taxableSales: invoice.taxableSales,
    avalara: invoice.avalara,
  }
}

function pickSnapshot(row) {
  const a = row.avalara || {}
  return {
    provider: a.provider,
    documentStatus: a.documentStatus,
    totalTax: a.totalTax,
    totalTaxable: a.totalTaxable,
    rate: a.rate,
    testOnly: a.testOnly,
    documentId: a.documentId || null,
    transactionCode: a.transactionCode,
    warnings: a.warnings || [],
    jurisdictions: Array.isArray(a.jurisdictions)
      ? a.jurisdictions.slice(0, 5).map((j) => ({
          name: j.jurisName || j.name,
          rate: j.rate,
          tax: j.tax,
        }))
      : [],
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)

  console.log('\n=== Local vs Avalara (Omaha NE 68106, $69,482 materials) ===\n')
  console.log('Configured TAX_ENGINE in .env:', process.env.TAX_ENGINE)
  console.log('After script runs, active provider:', getActiveTaxProvider(), '\n')

  const localRow = await runEngine('local')
  const avalaraRow = await runEngine('avalara')

  // Restore .env engine for the shell session
  process.env.TAX_ENGINE = 'avalara'

  const out = {
    local: pickSnapshot(localRow),
    avalara: pickSnapshot(avalaraRow),
    delta: {
      totalTax: round2((avalaraRow.avalara?.totalTax || 0) - (localRow.avalara?.totalTax || 0)),
      totalTaxable: round2(
        (avalaraRow.avalara?.totalTaxable || 0) - (localRow.avalara?.totalTaxable || 0)
      ),
    },
    localSkipped: localRow.calc?.skipped,
    avalaraSkipped: avalaraRow.calc?.skipped,
    avalaraError: avalaraRow.calc?.error || null,
  }

  console.log(JSON.stringify(out, null, 2))

  const taxSync = require('../src/services/tax/taxSync.service')
  const { isReturnsConfigured } = require('../src/config/taxEngine')
  console.log('\n--- Sync / compliance ---')
  console.log('Returns configured (OAuth):', isReturnsConfigured())
  console.log(
    'Note: state-wise Sync uses Avalara Returns only when AVALARA_RETURNS_CLIENT_ID/SECRET are set; else rolls up Committed invoices.'
  )

  await mongoose.disconnect()
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
