const roundRate = (n) => Math.round(Number(n) * 10000) / 10000

/** Effective rate % from collected vs taxable sales (sync / filing rows). */
const computeSalesTaxRate = (taxCollected, taxableSales) => {
  const taxable = Number(taxableSales || 0)
  const collected = Number(taxCollected || 0)
  if (taxable <= 0 || collected < 0) return null
  return roundRate((collected / taxable) * 100)
}

const formatSalesTaxRateLabel = (rate, { fallback = '' } = {}) => {
  const n = rate != null ? Number(rate) : NaN
  if (!Number.isFinite(n) || n <= 0) return fallback
  return `${n.toFixed(2)}% Sales Tax`
}

const salesTaxRateLabelForTax = (tax = {}) => {
  const stored = tax.salesTaxRate
  if (stored != null && Number(stored) > 0) {
    return formatSalesTaxRateLabel(stored)
  }
  const derived = computeSalesTaxRate(tax.taxCollected, tax.taxableSales)
  if (derived != null && derived > 0) {
    return formatSalesTaxRateLabel(derived)
  }
  return ''
}

module.exports = {
  computeSalesTaxRate,
  formatSalesTaxRateLabel,
  salesTaxRateLabelForTax,
}
