#!/usr/bin/env node
/**
 * Validates quoting tool parsers against client example files.
 * Usage: node scripts/test-quoting-tool.js
 */
const fs = require('fs')
const path = require('path')
const { parseShipperBuffer } = require('../src/services/quoting/shipperParser')
const { priceJob } = require('../src/services/quoting/pricingEngine')
const { buildPricingRates } = require('../src/services/quoting/pricingRulesAdapter')
const { extractDrawingPdfBuffer } = require('../src/services/quoting/drawingPdfExtractor')

const ROOT = path.join(__dirname, '..')
const PDF = path.join(ROOT, 'pdf_quote_example.pdf')
const XLSX = path.join(ROOT, 'shipper_excel_quote_example.xlsx')

async function main() {
  console.log('=== PDF extraction ===')
  const pdfBuf = fs.readFileSync(PDF)
  const pdf = await extractDrawingPdfBuffer(pdfBuf, { fileName: 'pdf_quote_example.pdf' })
  console.log('text items:', pdf.textItemCount, '| fields extracted:', pdf.filledCount)
  console.log('extracted:', JSON.stringify(pdf.extracted, null, 2))
  console.log('note:', pdf.note)

  console.log('\n=== Shipper parse ===')
  const xBuf = fs.readFileSync(XLSX)
  const parsed = parseShipperBuffer(xBuf, { sf: 0, customTabRules: [] })
  console.log('tabs:', parsed.sheetCount, '| total weight:', Math.round(parsed.totalWeightLbs), 'lbs')
  parsed.tabSummary.forEach((t) => {
    if (!t.skipped) console.log(`  ${t.sheetName} → ${t.category}: ${t.weightLbs} lbs`)
  })

  const sf = parsed.totalWeightLbs > 0 ? Math.round(parsed.totalWeightLbs / 9) : 5000
  const { pr } = buildPricingRates(null)
  const pricing = priceJob(parsed.categories, {
    jobType: 'PEMB',
    scope: 'Both',
    roof: 'screw-down',
    install: 'medium',
    sf,
    blendPct: 50,
    PR: pr,
  })

  console.log('\n=== Pricing (PEMB, Both, sf=' + sf + ') ===')
  console.log('Total sell: $' + Math.round(pricing.totSell).toLocaleString())
  console.log('Material cost: $' + Math.round(pricing.matCost).toLocaleString())
  console.log('Profit: $' + Math.round(pricing.profit).toLocaleString(), '(' + pricing.profPct + '%)')
  console.log('$/SF: $' + pricing.sfPrice)
  console.log('Weight:', Math.round(pricing.totWt).toLocaleString(), 'lbs | Trucks:', pricing.trucks)
  console.log('Breakdown rows:', pricing.rows.length)

  const { buildAndComputeFullPembQuote } = require('../src/services/quoting/quotePricingOrchestrator')
  const { lookupSalesTaxByZip } = require('../src/services/quoting/salesTaxLookup')
  const { generateAssembledHtml } = require('../src/services/quoting/quoteDocumentGenerator')

  const full = buildAndComputeFullPembQuote(parsed.categories, {
    jobType: 'PEMB',
    scope: 'both',
    roof: 'screw-down',
    install: 'medium',
    sf,
    blendPct: 50,
    PR: pr,
  }, {
    concrete: { include: true, costSF: 7.25, marginPct: 25 },
    salesTax: { rate: 7, include: true },
  })

  console.log('\n=== Full quote (concrete + tax) ===')
  console.log('Grand total: $' + Math.round(full.grandTotal).toLocaleString())
  console.log('Concrete: $' + Math.round(full.concrete.appliedSell).toLocaleString())
  console.log('Sales tax: $' + full.salesTax.amount)

  const tax = await lookupSalesTaxByZip('51503')
  console.log('\n=== Tax lookup 51503 ===')
  console.log(tax.message)

  const html = generateAssembledHtml({
    fullQuote: full,
    pricingResult: full.pricing,
    leadCompanyName: 'Test Customer',
    squareFootage: sf,
    sections: ['quote', 'sow'],
  })
  console.log('\n=== Document HTML ===')
  console.log('Assembled HTML length:', html.length, 'chars')

  console.log('\n✓ Quoting tool test complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
