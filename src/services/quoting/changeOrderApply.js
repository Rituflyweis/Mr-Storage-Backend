/**
 * Apply change-order revised totals onto a final EstimateQuote so contract
 * price, deposit, and milestones reflect the running CO newTotal.
 */

const ChangeOrder = require('../../models/ChangeOrder')
const {
  computeDeposit,
  computeMilestones,
  syncDepositIntoMilestoneRows,
} = require('./depositMilestoneEngine')

const round = (n) => Math.round(Number(n) || 0)

const baseQuoteTotalOf = (est = {}) =>
  round(
    est.originalContractValue ??
      est.fullQuoteResult?.grandTotal ??
      est.totalSell ??
      est.pricingResult?.totSell ??
      est.storagePricingResult?.grandTotal ??
      0,
  )

const rescalePaymentsForGrand = (est, grand) => {
  const g = round(grand)
  if (!g) return

  if (est.depositTerms) {
    const flat =
      est.depositTerms.flat != null && Number(est.depositTerms.flat) > 0
        ? Number(est.depositTerms.flat)
        : undefined
    const d = computeDeposit({
      grand: g,
      pct: est.depositTerms.pct,
      flat,
    })
    est.depositTerms = {
      ...d,
      flat: flat || undefined,
      note: est.depositTerms.note || '',
    }
  }

  const rows = Array.isArray(est.milestoneSchedule) ? est.milestoneSchedule : []
  if (est.depositTerms && (!rows.length || rows.some((r) => /^deposit\b/i.test(String(r?.label || ''))))) {
    const synced = syncDepositIntoMilestoneRows(rows, est.depositTerms, {
      flat: est.depositTerms.flat,
    })
    est.milestoneSchedule = computeMilestones({ grand: g, rows: synced }).rows
  } else if (rows.length) {
    est.milestoneSchedule = computeMilestones({ grand: g, rows }).rows
  }
}

/**
 * Recompute estimate.originalContractValue / revisedContractTotal from all COs
 * and push revised total into totalSell + fullQuoteResult.grandTotal.
 */
const syncEstimateFromChangeOrders = async (estimate) => {
  if (!estimate || !estimate._id) return null

  const cos = await ChangeOrder.find({ estimateQuoteId: estimate._id })
    .sort({ coNum: 1 })
    .lean()

  const base = baseQuoteTotalOf(estimate)

  if (!cos.length) {
    const restore = estimate.originalContractValue != null
      ? round(estimate.originalContractValue)
      : base
    estimate.revisedContractTotal = null
    if (estimate.originalContractValue != null) {
      estimate.totalSell = restore
      if (estimate.fullQuoteResult && typeof estimate.fullQuoteResult === 'object') {
        estimate.fullQuoteResult = {
          ...(estimate.fullQuoteResult.toObject
            ? estimate.fullQuoteResult.toObject()
            : estimate.fullQuoteResult),
          grandTotal: restore,
        }
        estimate.markModified('fullQuoteResult')
      }
      if (estimate.storagePricingResult && typeof estimate.storagePricingResult === 'object') {
        estimate.storagePricingResult = {
          ...(estimate.storagePricingResult.toObject
            ? estimate.storagePricingResult.toObject()
            : estimate.storagePricingResult),
          grandTotal: restore,
        }
        estimate.markModified('storagePricingResult')
      }
      rescalePaymentsForGrand(estimate, restore)
    }
    estimate.originalContractValue = null
    await estimate.save()
    return estimate
  }

  if (estimate.originalContractValue == null) {
    estimate.originalContractValue = round(cos[0].origVal != null ? cos[0].origVal : base)
  }

  const latest = cos.reduce((a, b) => (Number(b.coNum) > Number(a.coNum) ? b : a))
  const revised = round(latest.newTotal)
  estimate.revisedContractTotal = revised
  estimate.totalSell = revised

  if (estimate.fullQuoteResult && typeof estimate.fullQuoteResult === 'object') {
    estimate.fullQuoteResult = {
      ...(estimate.fullQuoteResult.toObject
        ? estimate.fullQuoteResult.toObject()
        : estimate.fullQuoteResult),
      grandTotal: revised,
      originalGrandTotal: estimate.originalContractValue,
    }
    estimate.markModified('fullQuoteResult')
  } else {
    estimate.fullQuoteResult = {
      grandTotal: revised,
      originalGrandTotal: estimate.originalContractValue,
    }
  }

  if (estimate.storagePricingResult && typeof estimate.storagePricingResult === 'object') {
    estimate.storagePricingResult = {
      ...(estimate.storagePricingResult.toObject
        ? estimate.storagePricingResult.toObject()
        : estimate.storagePricingResult),
      grandTotal: revised,
    }
    estimate.markModified('storagePricingResult')
  }

  rescalePaymentsForGrand(estimate, revised)
  await estimate.save()
  return estimate
}

const estimateRevisionSummary = (est) => {
  if (!est) return null
  return {
    _id: est._id,
    status: est.status,
    originalContractValue: est.originalContractValue,
    revisedContractTotal: est.revisedContractTotal,
    totalSell: est.totalSell,
    grandTotal: est.revisedContractTotal ?? est.fullQuoteResult?.grandTotal ?? est.totalSell,
    depositTerms: est.depositTerms || null,
    milestoneSchedule: est.milestoneSchedule || [],
  }
}

module.exports = {
  baseQuoteTotalOf,
  syncEstimateFromChangeOrders,
  estimateRevisionSummary,
  rescalePaymentsForGrand,
}
