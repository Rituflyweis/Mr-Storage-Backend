/** Margin override (quote tab lock) — port of HTML updateMarginPanel / applyMarginOverride */

const previewMarginOverride = (pricingResult, override = {}) => {
  if (!pricingResult) return null

  const res = pricingResult
  const laborVal = override.laborSF != null ? Number(override.laborSF) : null
  const pctVal = override.pct != null ? Number(override.pct) : null
  const sellFixed = override.sellFixed != null ? Number(override.sellFixed) : null

  let adjMatSell = res.matSell || 0
  let adjInstSell = res.instSell || 0
  let adjInstCost = res.instCost || 0

  const scopeKey = String(res.scope || 'both').toLowerCase()

  if (laborVal && scopeKey !== 'supply' && res.sf > 0) {
    const costPct = res.jobType === 'Storage' ? 0.68 : 0.65
    adjInstCost = res.sf * laborVal * costPct
    adjInstSell = res.sf * laborVal
  }

  let totCost = (res.matCost || 0) + (res.freight || 0) + adjInstCost
  let totSell =
    scopeKey === 'supply' ? adjMatSell : scopeKey === 'install' ? adjInstSell : adjMatSell + adjInstSell

  if (pctVal != null && !sellFixed) {
    const m = pctVal / 100
    totSell = m >= 1 ? totCost * 2 : totCost / (1 - m)
  }

  if (sellFixed) totSell = sellFixed

  const profit = totSell - totCost
  const profPct = totSell > 0 ? ((profit / totSell) * 100).toFixed(1) : '0'
  const sfPrice = res.sf > 0 ? (totSell / res.sf).toFixed(2) : '0'

  return {
    originalSell: Math.round(res.totSell || 0),
    adjusted: {
      totSell: Math.round(totSell),
      totCost: Math.round(totCost),
      profit: Math.round(profit),
      profPct,
      sfPrice,
      instSell: Math.round(adjInstSell),
      instCost: Math.round(adjInstCost),
    },
  }
}

const applyMarginOverride = (pricingResult, override = {}) => {
  const preview = previewMarginOverride(pricingResult, override)
  if (!preview) return pricingResult

  return {
    ...pricingResult,
    totSell: preview.adjusted.totSell,
    profit: preview.adjusted.profit,
    profPct: preview.adjusted.profPct,
    sfPrice: preview.adjusted.sfPrice,
    instSell: preview.adjusted.instSell,
    instCost: preview.adjusted.instCost,
    totCost: preview.adjusted.totCost,
    marginOverrideApplied: true,
  }
}

module.exports = {
  previewMarginOverride,
  applyMarginOverride,
}
