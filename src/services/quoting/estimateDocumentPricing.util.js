const round = (n) => Math.round(Number(n) || 0)

const normalizeScopeKey = (scope) => {
  const s = String(scope || 'both').toLowerCase()
  if (s === 'both') return 'both'
  if (s === 'supply') return 'supply'
  if (s === 'install') return 'install'
  return 'both'
}

const roofIsStandingSeam = (roofType) =>
  /standing\s*seam|\bss\b/i.test(String(roofType || ''))

/**
 * Minimal PEMB pricing blob for quote HTML when pricingResult was never saved
 * or was cleared — keeps breakdown rows in sync with contract total after COs.
 */
const synthesizePricingForDocument = (estimate = {}, contractGrand) => {
  const grand = round(
    contractGrand ??
      estimate.revisedContractTotal ??
      estimate.totalSell ??
      estimate.fullQuoteResult?.grandTotal ??
      0,
  )
  const sf = Number(estimate.squareFootage || estimate.pricingResult?.sf) || 0
  const scope = normalizeScopeKey(estimate.scope || estimate.pricingResult?.scope)
  const totSell = grand

  let matSell = 0
  let instSell = 0
  const old = estimate.pricingResult || estimate.fullQuoteResult?.pricing
  const oldTot = Number(old?.totSell) || 0

  if (old && oldTot > 0) {
    const ratio = totSell / oldTot
    matSell = round(Number(old.matSell || 0) * ratio)
    instSell = round(Number(old.instSell || 0) * ratio)
    const drawings = round(Number(old.pembDrawings || 0) * ratio)
    const building = totSell - drawings
    const splitSum = matSell + instSell
    if (splitSum > 0 && Math.abs(splitSum - building) > 1) {
      const fix = building / splitSum
      matSell = round(matSell * fix)
      instSell = building - matSell
    } else if (splitSum === 0) {
      if (scope === 'supply') matSell = building
      else if (scope === 'install') instSell = building
      else {
        matSell = round(building / 2)
        instSell = building - matSell
      }
    }
    return {
      ...old,
      sf: old.sf || sf,
      scope: old.scope || scope,
      jobType: old.jobType || estimate.jobType || 'PEMB',
      totSell,
      matSell,
      instSell,
      pembDrawings: round(Number(old.pembDrawings || 0) * ratio),
      totWt: old.totWt,
      trucks: old.trucks,
      steelFinish: old.steelFinish,
      isSS: old.isSS ?? roofIsStandingSeam(estimate.roofType),
    }
  }

  if (scope === 'supply') matSell = totSell
  else if (scope === 'install') instSell = totSell
  else {
    matSell = round(totSell / 2)
    instSell = totSell - matSell
  }

  return {
    sf,
    scope,
    jobType: estimate.jobType || 'PEMB',
    isSS: roofIsStandingSeam(estimate.roofType),
    totSell,
    matSell,
    instSell,
    totWt: 0,
    trucks: 0,
    pembDrawings: 0,
    steelFinish: estimate.quoteControls?.steelFinish || 'red-iron',
    sfPrice: sf > 0 ? (totSell / sf).toFixed(2) : null,
  }
}

/** Scale saved pricing line items when revised contract total changes (change orders). */
const scalePricingResultToContractTotal = (pricing, previousTotal, revisedTotal) => {
  if (!pricing || typeof pricing !== 'object') return null
  const prev = round(previousTotal)
  const next = round(revisedTotal)
  if (!prev || !next || prev === next) return pricing
  const ratio = next / prev
  const scale = (v) => (v == null || v === '' ? v : round(Number(v) * ratio))
  return {
    ...pricing,
    totSell: next,
    matSell: scale(pricing.matSell),
    instSell: scale(pricing.instSell),
    matCost: scale(pricing.matCost),
    instCost: scale(pricing.instCost),
    totCost: scale(pricing.totCost),
    pembDrawings: scale(pricing.pembDrawings),
    totWt: pricing.totWt,
    trucks: pricing.trucks,
  }
}

module.exports = {
  synthesizePricingForDocument,
  scalePricingResultToContractTotal,
  normalizeScopeKey,
}
