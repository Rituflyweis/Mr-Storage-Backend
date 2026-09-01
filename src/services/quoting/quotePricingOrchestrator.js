/** Full PEMB quote assembly — base pricing + overrides + addons + tax */

const { priceJob } = require('./pricingEngine')
const { computeConcreteAddon, computeInsulationAddon } = require('./addonPricing')
const { previewCogsOverride, applyCogsOverride } = require('./cogsOverride')
const { previewMarginOverride, applyMarginOverride } = require('./marginOverride')
const { computePembSalesTax } = require('./salesTaxLookup')

const computeFullPembQuote = (basePricing, options = {}) => {
  let pricing = { ...basePricing }

  if (options.cogsOverride?.applied) {
    pricing = applyCogsOverride(pricing, options.cogsOverride)
  }

  if (options.marginOverride?.applied) {
    pricing = applyMarginOverride(pricing, options.marginOverride)
  }

  const sf = pricing.sf || options.sf || 0
  const concrete = computeConcreteAddon(options.concrete, sf)
  const insulation = computeInsulationAddon(options.insulation, sf)
  const salesTax = computePembSalesTax(pricing, insulation, options.salesTax || {})

  const buildingSubtotal = pricing.totSell || 0
  const grandTotal = Math.round(
    buildingSubtotal +
      (concrete.include ? concrete.appliedSell : 0) +
      (insulation.include ? insulation.appliedSell : 0) +
      salesTax.amount
  )

  const addonProfit =
    (concrete.include ? concrete.profit : 0) + (insulation.include ? insulation.profit : 0)
  const totalProfit = Math.round((pricing.profit || 0) + addonProfit)
  const grandMargin = grandTotal > 0 ? ((totalProfit / grandTotal) * 100).toFixed(1) : '0'

  const cogsPreview = options.cogsOverride
    ? previewCogsOverride(basePricing, options.cogsOverride)
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
