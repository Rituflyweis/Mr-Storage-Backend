/** COGS / Material Sell Override — port of HTML cogs + breakdownMatOverrideApply */

const toPositiveNumber = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Material Sell Override UI enters shipper/material sell EXCLUDING freight
 * (placeholder = matSell - freight). Engine `matSell` always INCLUDES freight.
 */
const pickMaterialSellOverride = (override = {}, extras = {}) => {
  const candidates = [
    extras.materialSellOverride,
    extras.matSellOverride,
    extras.quoteControls?.materialSellOverride,
    extras.quoteControls?.matSellOverride,
    override.materialSellOverride,
    override.matSellOverride,
    override.materialSell,
  ]
  for (const c of candidates) {
    const n = toPositiveNumber(c)
    if (n != null) return n
  }
  return null
}

/** Normalize FE payloads: aliases, auto-applied when override dollars are present. */
const normalizeCogsOverrideInput = (override, extras = {}) => {
  const matOnly = pickMaterialSellOverride(override || {}, extras)
  if (!override && matOnly == null) return null

  const next = { ...(override || {}) }
  if (matOnly != null) {
    next.materialSellOverride = matOnly
  }

  const hasSellIntent =
    toPositiveNumber(next.materialSellOverride) != null ||
    toPositiveNumber(next.sellDollar) != null ||
    (next.costDollar != null && next.costDollar !== '')

  // FE often sends sellDollar / materialSellOverride without applied:true — treat as apply.
  // Explicit applied:false still wins (preview-only).
  if (hasSellIntent && next.applied !== false) {
    next.applied = true
  }

  return next
}

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

/**
 * Resolve adjusted ENGINE matSell (includes freight) + cost basis.
 *
 * - materialSellOverride / sellBasis=ex_freight → UI material-only + freight
 * - sellDollar (default) → full matSell including freight (COGS panel)
 */
const resolveAdjustedMaterial = (comp, override = {}, freight = 0) => {
  const adjCost = override.costDollar != null ? Number(override.costDollar) : comp.cost

  const matOnly = toPositiveNumber(override.materialSellOverride)
  const sellBasis = String(override.sellBasis || override.basis || '').toLowerCase()
  const sellExFreight =
    matOnly != null ||
    override.sellIncludesFreight === false ||
    sellBasis === 'ex_freight' ||
    sellBasis === 'material_only' ||
    sellBasis === 'material_ex_freight'

  let adjSell
  if (matOnly != null) {
    adjSell = matOnly + freight
  } else if (override.sellDollar != null && override.sellDollar !== '') {
    const raw = Number(override.sellDollar)
    adjSell = sellExFreight ? raw + freight : raw
  } else if (override._marginExplicitlySet || override.marginExplicit) {
    const m = Number(override.marginPct ?? 20) / 100
    adjSell = m >= 1 ? adjCost * 2 : adjCost / (1 - m)
  } else if (override.marginPct != null && override.costDollar != null) {
    const m = Number(override.marginPct ?? 20) / 100
    adjSell = m >= 1 ? adjCost * 2 : adjCost / (1 - m)
  } else if (override.marginPct != null && Number(override.marginPct) !== 20) {
    const m = Number(override.marginPct) / 100
    adjSell = m >= 1 ? adjCost * 2 : adjCost / (1 - m)
  } else {
    // Cost-only change: keep shipper sell (profit absorbs cost delta) — matches HTML updateCOGSSummary
    adjSell = comp.sell
  }

  return {
    adjCost,
    adjSell,
    materialSellExFreight: Math.max(0, adjSell - freight),
  }
}

const previewCogsOverride = (pricingResult, override = {}) => {
  const comp = getCogsComputed(pricingResult)
  if (!comp) return null

  const res = pricingResult
  const freight = res.freight || 0
  const { adjCost, adjSell, materialSellExFreight } = resolveAdjustedMaterial(
    comp,
    override,
    freight
  )
  const scopeKey = String(res.scope || 'both').toLowerCase()
  const instSell = res.instSell || 0
  const instCost = res.instCost || 0

  // adjSell is engine matSell (includes freight). Grand = matSell + install (not + freight again).
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
      materialSellExFreight: Math.round(materialSellExFreight),
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
  // Engine invariant: matSell includes freight.
  next.matSell = preview.adjusted.sell
  next.totSell = preview.adjusted.grandSell
  next.totCost = preview.adjusted.grandCost
  next.profit = preview.adjusted.profit
  next.profPct = String(preview.adjusted.totalMargin)
  next.sfPrice = preview.adjusted.sfPrice
  next.cogsOverrideApplied = true
  next.materialSellOverrideApplied = toPositiveNumber(override.materialSellOverride) != null
  next.materialSellExFreight = preview.adjusted.materialSellExFreight
  return next
}

module.exports = {
  getCogsComputed,
  previewCogsOverride,
  applyCogsOverride,
  normalizeCogsOverrideInput,
  pickMaterialSellOverride,
}
