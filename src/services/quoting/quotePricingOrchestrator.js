/** Full PEMB quote assembly — base pricing + overrides + addons + tax */

const { priceJob } = require('./pricingEngine')
const { computeConcreteAddon, computeInsulationAddon } = require('./addonPricing')
const {
  previewCogsOverride,
  applyCogsOverride,
  normalizeCogsOverrideInput,
} = require('./cogsOverride')
const { previewMarginOverride, applyMarginOverride } = require('./marginOverride')
const { computePembSalesTax } = require('./salesTaxLookup')
const { normalizePembAddOns, sumPembAddOnTotals } = require('./pembAddOns')
const { computeStaircase } = require('./staircase')

const computeFullPembQuote = (basePricing, options = {}) => {
  let pricing = { ...basePricing }

  const cogsOverride = normalizeCogsOverrideInput(options.cogsOverride, options)
  if (cogsOverride?.applied) {
    pricing = applyCogsOverride(pricing, cogsOverride)
  }

  if (options.marginOverride?.applied) {
    pricing = applyMarginOverride(pricing, options.marginOverride)
  }

  const sf = pricing.sf || options.sf || 0
  const concrete = computeConcreteAddon(options.concrete, sf)
  const insulation = computeInsulationAddon(options.insulation, sf)
  const salesTax = computePembSalesTax(pricing, insulation, options.salesTax || {})

  const pembAddOns = normalizePembAddOns(options.pembAddOns || [])
  const pembAddOnTotals = sumPembAddOnTotals(pembAddOns)
  const scopeKey = String(pricing.scope || options.scope || 'both').toLowerCase()
  const addOnSell = scopeKey === 'install' ? 0 : pembAddOnTotals.sell

  // Multi-story fabricated staircases (v7). Sell adds to the building subtotal;
  // cost defaults to the sell (profit 0) unless an explicit unit cost is given.
  const staircase = computeStaircase(options.staircase || {})
  const staircaseSell = staircase.include && scopeKey !== 'install' ? staircase.staircaseSell : 0

  const buildingSubtotal = pricing.totSell || 0
  const grandTotal = Math.round(
    buildingSubtotal +
      addOnSell +
      staircaseSell +
      (concrete.include ? concrete.appliedSell : 0) +
      (insulation.include ? insulation.appliedSell : 0) +
      salesTax.amount
  )

  const addonProfit =
    (concrete.include ? concrete.profit : 0) +
    (insulation.include ? insulation.profit : 0) +
    (scopeKey === 'install' ? 0 : pembAddOnTotals.profit)
  const totalProfit = Math.round((pricing.profit || 0) + addonProfit)
  const grandMargin = grandTotal > 0 ? ((totalProfit / grandTotal) * 100).toFixed(1) : '0'

  const cogsPreview = cogsOverride
    ? previewCogsOverride(basePricing, cogsOverride)
    : null
  const marginPreview = options.marginOverride
    ? previewMarginOverride(basePricing, options.marginOverride)
    : null

  return {
    pricing,
    concrete,
    insulation,
    salesTax,
    buildingSubtotal: Math.round(buildingSubtotal),
    grandTotal,
    pricePerSf: sf > 0 ? (grandTotal / sf).toFixed(2) : pricing.sfPrice,
    totalProfit,
    grandMargin: Number(grandMargin),
    cogsPreview,
    marginPreview,
    cogsOverride: cogsOverride || null,
    pembAddOns,
    pembAddOnTotals,
    staircase,
  }
}

const buildAndComputeFullPembQuote = (categories, engineOptions, fullOptions = {}) => {
  const basePricing = priceJob(categories, engineOptions)
  return computeFullPembQuote(basePricing, { ...fullOptions, sf: engineOptions.sf })
}

module.exports = {
  computeFullPembQuote,
  buildAndComputeFullPembQuote,
}
