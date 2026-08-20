/** COGS override panel — port of HTML cogsGetComputed / updateCOGSSummary / applyCOGS */

const getCogsComputed = (pricingResult) => {
  if (!pricingResult) return null
  const computedCost = (pricingResult.matCost || 0) + (pricingResult.freight || 0)
  const computedSell = pricingResult.matSell || 0
  const computedMargin =
    computedSell > 0 ? ((computedSell - computedCost) / computedSell) * 100 : 0
  return {
    cost: computedCost,
    sell: computedSell,
    margin: computedMargin,
    sf: pricingResult.sf || 1,
  }
}

const resolveAdjustedMaterial = (comp, override = {}) => {
  const adjCost = override.costDollar != null ? Number(override.costDollar) : comp.cost
  let adjSell
  if (override.sellDollar != null) {
    adjSell = Number(override.sellDollar)
  } else {
    const m = Number(override.marginPct ?? 20) / 100
    adjSell = m >= 1 ? adjCost * 2 : adjCost / (1 - m)
  }
  return { adjCost, adjSell }
}

const previewCogsOverride = (pricingResult, override = {}) => {
  const comp = getCogsComputed(pricingResult)
  if (!comp) return null

  const { adjCost, adjSell } = resolveAdjustedMaterial(comp, override)
  const res = pricingResult
  const scopeKey = String(res.scope || 'both').toLowerCase()
  const instSell = res.instSell || 0
  const instCost = res.instCost || 0

  const grandSell =
    scopeKey === 'supply' ? adjSell : scopeKey === 'install' ? instSell : adjSell + instSell
  const grandCost =
    scopeKey === 'supply' ? adjCost : scopeKey === 'install' ? instCost : adjCost + instCost
  const profit = grandSell - grandCost
  const matProfit = adjSell - adjCost
  const matMargin = adjSell > 0 ? (matProfit / adjSell) * 100 : 0
  const totalMargin = grandSell > 0 ? (profit / grandSell) * 100 : 0
  const sfPrice = comp.sf > 0 ? (grandSell / comp.sf).toFixed(2) : '0'

  return {
    fromShipper: comp,
    adjusted: {
      cost: Math.round(adjCost),
      sell: Math.round(adjSell),
      matMargin: Number(matMargin.toFixed(1)),
      grandSell: Math.round(grandSell),
      grandCost: Math.round(grandCost),
      profit: Math.round(profit),
      totalMargin: Number(totalMargin.toFixed(1)),
      sfPrice,
      costDiff: Math.round(adjCost - comp.cost),
      sellDiff: Math.round(adjSell - comp.sell),
    },
  }
}

const applyCogsOverride = (pricingResult, override = {}) => {
  const preview = previewCogsOverride(pricingResult, override)
  if (!preview) return pricingResult

  const freightOrig = pricingResult.freight || 0
  const next = { ...pricingResult }
  next.matCost = preview.adjusted.cost - freightOrig
  next.matSell = preview.adjusted.sell - freightOrig
  next.totSell = preview.adjusted.grandSell
  next.totCost = preview.adjusted.grandCost
  next.profit = preview.adjusted.profit
  next.profPct = String(preview.adjusted.totalMargin)
  next.sfPrice = preview.adjusted.sfPrice
  next.cogsOverrideApplied = true
  return next
}

module.exports = {
  getCogsComputed,
  previewCogsOverride,
  applyCogsOverride,
}
