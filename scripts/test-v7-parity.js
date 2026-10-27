/* eslint-disable no-console */
/**
 * v7 parity tests — verify the ported engines reproduce SM-QuotingTool v7
 * formulas exactly, and that every new module loads. No DB required.
 *   node scripts/test-v7-parity.js
 */

const assert = require('assert')

let pass = 0
const check = (name, fn) => {
  try {
    fn()
    console.log('  ✓', name)
    pass++
  } catch (e) {
    console.error('  ✗', name, '\n    ', e.message)
    process.exitCode = 1
  }
}

const { computeChangeOrder, nextChangeOrderContext } = require('../src/services/quoting/changeOrderEngine')
const { computeCustomQuote } = require('../src/services/quoting/customQuoteEngine')
const { computeDeposit, computeMilestones } = require('../src/services/quoting/depositMilestoneEngine')
const { computeStaircase } = require('../src/services/quoting/staircase')
const { computeFullPembQuote } = require('../src/services/quoting/quotePricingOrchestrator')

console.log('Change Orders')
check('amount + cost → newTotal/profit/margin', () => {
  const r = computeChangeOrder({ origVal: 500000, amount: 12500, cost: 9000 })
  assert.strictEqual(r.newTotal, 512500)
  assert.strictEqual(r.profit, 3500)
  assert.strictEqual(r.margin, 28.0)
})
check('markup derives amount (sell = cost/(1-mu))', () => {
  const r = computeChangeOrder({ origVal: 500000, cost: 9000, markup: 25 })
  assert.strictEqual(r.amount, 12000)
  assert.strictEqual(r.newTotal, 512000)
})
check('negative CO amount lowers total', () => {
  const r = computeChangeOrder({ origVal: 500000, amount: -5000 })
  assert.strictEqual(r.newTotal, 495000)
  assert.strictEqual(r.profit, null)
})
check('nextChangeOrderContext numbering + running total', () => {
  const ctx0 = nextChangeOrderContext([], 500000)
  assert.deepStrictEqual(ctx0, { coNum: 1, origVal: 500000 })
  const ctx1 = nextChangeOrderContext([{ coNum: 1, newTotal: 512500 }], 500000)
  assert.deepStrictEqual(ctx1, { coNum: 2, origVal: 512500 })
})

console.log('Custom Quote')
check('margin-based sell', () => {
  const r = computeCustomQuote({ matCost: 100000, freight: 5000, laborCost: 20000, marginPct: 20 })
  assert.strictEqual(r.totalCost, 125000)
  assert.strictEqual(r.sell, 156250)
  assert.strictEqual(r.profit, 31250)
  assert.strictEqual(r.profPct, 20.0)
})
check('sell override wins', () => {
  const r = computeCustomQuote({ matCost: 100000, freight: 5000, laborCost: 20000, sellOverride: 200000 })
  assert.strictEqual(r.sell, 200000)
  assert.strictEqual(r.profit, 75000)
  assert.strictEqual(r.profPct, 37.5)
})

console.log('Deposit')
check('percent deposit', () => {
  const r = computeDeposit({ grand: 512500, pct: 30 })
  assert.strictEqual(r.deposit, 153750)
  assert.strictEqual(r.balance, 358750)
})
check('flat deposit back-solves pct', () => {
  const r = computeDeposit({ grand: 512500, flat: 200000 })
  assert.strictEqual(r.deposit, 200000)
  assert.strictEqual(r.pct, 39)
  assert.strictEqual(r.balance, 312500)
})

console.log('Milestones')
check('schedule totals', () => {
  const r = computeMilestones({
    grand: 500000,
    rows: [{ amount: 100000 }, { amount: 150000 }, { amount: 100000 }],
  })
  assert.strictEqual(r.scheduled, 350000)
  assert.strictEqual(r.remaining, 150000)
  assert.strictEqual(r.pct, 70)
  assert.strictEqual(r.fullyScheduled, false)
})

console.log('Staircase')
check('count × unit', () => {
  const r = computeStaircase({ count: 2, unitCost: 35000 })
  assert.strictEqual(r.staircaseSell, 70000)
  assert.strictEqual(r.include, true)
})
check('default unit = 35000', () => {
  assert.strictEqual(computeStaircase({ count: 1 }).staircaseSell, 35000)
})

console.log('Orchestrator staircase integration')
check('staircase sell adds to grand total', () => {
  const base = { totSell: 500000, profit: 100000, sf: 10000, scope: 'both' }
  const full = computeFullPembQuote(base, { staircase: { count: 2, unitCost: 35000 }, sf: 10000 })
  assert.strictEqual(full.grandTotal, 570000)
  assert.strictEqual(full.staircase.staircaseSell, 70000)
})
check('staircase excluded on install-only scope', () => {
  const base = { totSell: 80000, profit: 20000, sf: 10000, scope: 'install' }
  const full = computeFullPembQuote(base, { staircase: { count: 2 }, scope: 'install', sf: 10000 })
  assert.strictEqual(full.grandTotal, 80000)
})

console.log('Module load (documents + controllers)')
check('document generators load', () => {
  require('../src/services/quoting/changeOrderDocument')
  require('../src/services/quoting/customQuoteDocument')
  require('../src/services/quoting/depositMilestoneDocument')
  require('../src/services/quoting/companyInfo')
})
check('change-order document renders HTML', () => {
  const { generateChangeOrderHtml } = require('../src/services/quoting/changeOrderDocument')
  const html = generateChangeOrderHtml(
    { coNum: 1, customer: 'Acme', origDate: 'Jan 1, 2026', origVal: 500000, amount: 12500, newTotal: 512500, desc: 'Added bay' },
    { baseOrigVal: 500000, priorCOs: [] },
  )
  assert.ok(html.includes('CHANGE ORDER #1'))
  assert.ok(html.includes('$512,500'))
})
check('custom-quote document renders HTML', () => {
  const { generateCustomQuoteHtml } = require('../src/services/quoting/customQuoteDocument')
  const html = generateCustomQuoteHtml({
    customer: 'Acme', matCost: 100000, freight: 5000, laborCost: 20000, marginPct: 20,
  })
  assert.ok(html.includes('$156,250'))
})
check('deposit + milestone documents render HTML', () => {
  const { generateDepositReceiptHtml, generateMilestoneScheduleHtml } = require('../src/services/quoting/depositMilestoneDocument')
  assert.ok(generateDepositReceiptHtml({ quote: { customer: 'Acme' }, grand: 512500, pct: 30 }).includes('$153,750'))
  assert.ok(
    generateMilestoneScheduleHtml({ quote: { customer: 'Acme' }, grand: 500000, rows: [{ label: 'Deposit', amount: 150000 }] }).includes('MILESTONE SCHEDULE'),
  )
})

console.log(`\n${process.exitCode ? 'FAILED' : 'ALL PASSED'} — ${pass} checks passed`)
