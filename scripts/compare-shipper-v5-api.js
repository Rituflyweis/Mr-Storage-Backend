#!/usr/bin/env node
/**
 * Upload shipper_excel_quote_example.xlsx through v5 (browser) and API/backend paths.
 * Usage: node scripts/compare-shipper-v5-api.js
 */
const fs = require('fs')
const path = require('path')
const { launchBrowser } = require('../src/utils/puppeteerLaunch')
const { parseShipperBuffer } = require('../src/services/quoting/shipperParser')
const { buildPricingRates } = require('../src/services/quoting/pricingRulesAdapter')
const { priceJob } = require('../src/services/quoting/pricingEngine')

const ROOT = path.join(__dirname, '..')
const XLSX = path.join(ROOT, 'shipper_excel_quote_example.xlsx')
const V5_HTML = path.join(ROOT, 'SM-QuotingTool-v5 (31).html')

async function runV5Browser() {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(60000)
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('[v5 browser]', msg.text())
    })
    await page.goto(`file://${V5_HTML}`, { waitUntil: 'networkidle0', timeout: 120000 })

    const fileBase64 = fs.readFileSync(XLSX).toString('base64')
    const fileName = path.basename(XLSX)

    return page.evaluate(
      ({ fileBase64, fileName }) => {
        currentJobType = 'PEMB'
        currentScope = 'supply'
        currentRoof = 'screw-down'
        currentInstall = 'easy'
        currentBlend = 50
        currentPembInstallCost = 5.5
        currentPembInstallSell = 8.5
        const sfField = document.getElementById('building-sf')
        if (sfField) sfField.value = ''

        const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0))
        const wb = XLSX.read(bytes, { type: 'array' })
        const sfFromField = parseInt(document.getElementById('building-sf')?.value, 10) || 0
        const cats = parseShipper(wb, sfFromField)
        const totWt = Object.values(cats).reduce(
          (a, c) => a + (typeof c === 'object' && c.weight ? c.weight : 0),
          0
        )
        const sf = sfFromField || (totWt > 0 ? Math.round(totWt / 9) : 0)
        const res = priceJob(
          cats,
          currentJobType,
          currentScope,
          currentRoof,
          currentInstall,
          sf
        )
        currentData = { res, cats, filename: fileName }

        const matCogs = Math.round((res.matCost || 0) + (res.freight || 0))
        return {
          fileName,
          tabs: Object.keys(cats).filter((k) => cats[k]?.weight > 0).length,
          weight: Math.round(res.totWt || 0),
          sf: res.sf,
          rows: res.rows?.length || 0,
          matCost: Math.round(res.matCost || 0),
          freight: Math.round(res.freight || 0),
          matCogs,
          matSell: Math.round(res.matSell || 0),
          installSell: Math.round(res.instSell || 0),
          totSell: Math.round(res.totSell || 0),
          profit: Math.round(res.profit || 0),
          profPct: res.profPct,
          sfPrice: res.sfPrice,
          scope: res.scope,
          categories: Object.entries(cats)
            .filter(([, v]) => v && v.weight > 0)
            .map(([k, v]) => `${k}:${Math.round(v.weight)}`),
        }
      },
      { fileBase64, fileName }
    )
  } finally {
    await browser.close()
  }
}

function runApiBackend(scope = 'supply') {
  const buf = fs.readFileSync(XLSX)
  const parsed = parseShipperBuffer(buf, { sf: 0, customTabRules: [] })
  const sf = Math.round(parsed.totalWeightLbs / 9)
  const { pr } = buildPricingRates(null)
  const pricing = priceJob(parsed.categories, {
    jobType: 'PEMB',
    scope,
    roof: 'screw-down',
    install: 'medium',
    sf,
    blendPct: 50,
    installCostPerSf: 5.5,
    sellPerSf: 8.5,
    PR: pr,
  })
  const matCogs = Math.round((pricing.matCost || 0) + (pricing.freight || 0))
  return {
    fileName: 'shipper_excel_quote_example.xlsx',
    tabs: parsed.sheetCount,
    weight: Math.round(parsed.totalWeightLbs),
    sf,
    rows: pricing.rows.length,
    matCost: Math.round(pricing.matCost),
    freight: Math.round(pricing.freight),
    matCogs,
    matSell: Math.round(pricing.matSell),
    installSell: Math.round(pricing.instSell),
    totSell: Math.round(pricing.totSell),
    profit: Math.round(pricing.profit),
    profPct: pricing.profPct,
    sfPrice: pricing.sfPrice,
    scope,
    categories: Object.entries(parsed.categories)
      .filter(([, v]) => v.weight > 0)
      .map(([k, v]) => `${k}:${Math.round(v.weight)}`),
  }
}

function diff(a, b) {
  const keys = [
    'weight',
    'sf',
    'rows',
    'matCost',
    'freight',
    'matCogs',
    'matSell',
    'installSell',
    'totSell',
    'profit',
  ]
  const out = {}
  keys.forEach((k) => {
    out[k] = { v5: a[k], api: b[k], match: a[k] === b[k] }
  })
  out.categoriesMatch =
    JSON.stringify([...(a.categories || [])].sort()) ===
    JSON.stringify([...(b.categories || [])].sort())
  return out
}

async function main() {
  console.log('Running v5 browser upload...')
  const v5 = await runV5Browser()
  console.log('Running API/backend path (supply scope)...')
  const api = runApiBackend('supply')

  console.log('\n=== v5 (SM-QuotingTool-v5) ===')
  console.log(JSON.stringify(v5, null, 2))
  console.log('\n=== API/backend (extract-shipper + compute) ===')
  console.log(JSON.stringify(api, null, 2))
  console.log('\n=== Parity check ===')
  console.log(JSON.stringify(diff(v5, api), null, 2))

  const mismatches = Object.entries(diff(v5, api)).filter(
    ([, v]) => v.match === false
  )
  if (mismatches.length) {
    console.error('\nMISMATCH:', mismatches.map(([k]) => k).join(', '))
    process.exit(1)
  }
  console.log('\n✓ v5 and API/backend match for shipper_excel_quote_example.xlsx')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
