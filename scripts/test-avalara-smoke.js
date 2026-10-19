/**
 * AvaTax sandbox smoke test (no server). Uses .env AVATAX_* / AVALARA_*.
 * Run: node scripts/test-avalara-smoke.js
 */
require('dotenv').config()

const avatax = require('../src/services/avalara/avataxClient')
const {
  getActiveTaxProvider,
  isAvalaraConfigured,
  getCompanyCode,
  getAccountId,
  getBaseUrl,
  getAvalaraEnv,
} = require('../src/config/taxEngine')
const { getShipFromTaxReadiness } = require('../src/utils/avalaraShipFrom.util')
const { buildTaxLinesFromInvoice } = require('../src/services/tax/invoiceTaxLines.util')

const ok = (label, detail = '') => console.log(`  ✓ ${label}${detail ? `: ${detail}` : ''}`)
const fail = (label, err) => {
  console.error(`  ✗ ${label}:`, err?.message || err)
  process.exitCode = 1
}

async function main() {
  console.log('\n=== Avalara smoke test ===\n')
  console.log('Env:', getAvalaraEnv(), '| Base:', getBaseUrl())
  console.log('Account id:', getAccountId() ? `${getAccountId().slice(0, 4)}…` : '(missing)')
  console.log('Company code (env):', getCompanyCode() || '(missing)')
  console.log('TAX_ENGINE active provider:', getActiveTaxProvider())
  console.log('Configured:', isAvalaraConfigured())

  if (!isAvalaraConfigured()) {
    fail('Config', new Error('Set AVATAX_ACCOUNT_ID, AVATAX_LICENSE_KEY, AVATAX_COMPANY_CODE'))
    return
  }

  try {
    const ping = await avatax.ping()
    ok('Ping', ping?.version || 'ok')
  } catch (e) {
    fail('Ping', e)
    return
  }

  let companies = []
  try {
    companies = await avatax.listCompanies()
    ok('List companies', `${companies.length} active`)
    companies.slice(0, 5).forEach((c) => {
      console.log(`      - ${c.companyCode} | ${c.name}`)
    })
    const match = companies.find(
      (c) =>
        c.companyCode === getCompanyCode() ||
        String(c.name || '').toLowerCase().includes('steel')
    )
    if (match && match.companyCode !== getCompanyCode()) {
      console.log(`\n  ⚠ AVATAX_COMPANY_CODE may be wrong. Try: ${match.companyCode} (${match.name})`)
    } else if (!companies.some((c) => c.companyCode === getCompanyCode())) {
      console.log(`\n  ⚠ No company with code "${getCompanyCode()}". Pick a code from the list above.`)
    }
  } catch (e) {
    fail('List companies', e)
    if (String(e.message).includes('401') && getAvalaraEnv() === 'sandbox') {
      console.log(
        '  → Ping can succeed on sandbox without valid credentials. If your license is production-only, set AVATAX_ENV=production (or AVALARA_ENV=production).'
      )
    }
  }

  const shipFrom = getShipFromTaxReadiness({})
  if (shipFrom.ready) {
    ok('Ship-from ready', `${shipFrom.address.city}, ${shipFrom.address.state} ${shipFrom.address.postalCode}`)
  } else {
    fail('Ship-from', new Error(shipFrom.error || 'incomplete'))
  }

  const fakeInvoice = {
    lineItems: [
      { description: 'Steel materials', quantity: 1, total: 1000, rate: 1000 },
      { description: 'Labor install', quantity: 1, total: 500, rate: 500 },
    ],
    subtotal: 1500,
    revision: 1,
  }
  const { lines } = buildTaxLinesFromInvoice(fakeInvoice)
  ok('Tax line builder', `${lines.length} lines (${lines.map((l) => l.taxCode).join(', ')})`)

  if (!shipFrom.ready) return

  const companyCode = getCompanyCode()
  const model = {
    lines,
    type: 'SalesInvoice',
    companyCode,
    date: new Date().toISOString().slice(0, 10),
    customerCode: 'SMOKE-TEST',
    code: `SMOKE-${Date.now()}`,
    currencyCode: 'USD',
    commit: false,
    addresses: {
      shipFrom: avatax.toAvaAddress(shipFrom.address),
      shipTo: avatax.toAvaAddress({
        line1: '100 Main St',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75201',
        country: 'US',
      }),
    },
    description: 'Mr Storage Avalara smoke test',
  }

  try {
    const result = await avatax.createTransaction(model)
    ok(
      'CreateTransaction (uncommitted)',
      `tax=$${result.totalTax} taxable=$${result.totalTaxable} status=${result.status}`
    )
    if (Number(result.totalTax) <= 0) {
      console.log(
        '  ⚠ Tax is 0 — often no nexus in ship-to state (Dallas TX test). Retry with an in-state address or confirm nexus in AvaTax.'
      )
    }
  } catch (e) {
    fail('CreateTransaction', e)
    if (String(e.message).includes('CompanyNotFound')) {
      console.log('  → Fix AVATAX_COMPANY_CODE using the company list above.')
    }
  }

  const returnsClient = require('../src/services/avalara/returnsGraphqlClient')
  if (returnsClient.isReturnsConfigured()) {
    try {
      await returnsClient.fetchAccessToken()
      ok('Returns OAuth token')
    } catch (e) {
      fail('Returns OAuth (optional)', e)
    }
  } else {
    console.log('  ○ Returns OAuth skipped (set AVALARA_COMPANY_ID for filing sync)')
  }

  console.log('\n=== Done ===\n')
  if (process.env.TAX_ENGINE !== 'avalara') {
    console.log('Note: TAX_ENGINE is not "avalara" — app still uses local/legacy until you flip it after this passes.\n')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
