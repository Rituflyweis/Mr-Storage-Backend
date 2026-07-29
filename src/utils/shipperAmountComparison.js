const ConsolidatedBOM = require('../models/ConsolidatedBOM')

const AMOUNT_TOLERANCE = 0.005

const normalizeAmount = (value) => {
  if (value == null || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

const roundAmount = (value) => Math.round(value * 100) / 100

const amountsEqual = (left, right) => Math.abs(left - right) <= AMOUNT_TOLERANCE

/** Compare consolidated BOM total cost vs vendor submitted quote amount. */
const buildShipperAmountComparison = (bomAmount, shipperSubmittedAmount) => {
  const bom = normalizeAmount(bomAmount)
  const shipper = normalizeAmount(shipperSubmittedAmount)

  const canCompare = bom != null && shipper != null
  const difference = canCompare ? roundAmount(shipper - bom) : null
  const isMismatch = canCompare ? !amountsEqual(bom, shipper) : null

  return {
    bomAmount: bom,
    shipperSubmittedAmount: shipper,
    difference,
    isMismatch,
    canCompare,
  }
}

const loadConsolidatedBomCostMap = async (requests = []) => {
  const ids = [
    ...new Set(
      requests
        .map((row) => row?.consolidatedBOMId)
        .filter(Boolean)
        .map(String)
    ),
  ]

  if (!ids.length) return new Map()

  const rows = await ConsolidatedBOM.find({ _id: { $in: ids } })
    .select('_id totalCost')
    .lean()

  return new Map(
    rows.map((row) => [String(row._id), normalizeAmount(row.totalCost)])
  )
}

const buildAmountComparisonForRequest = (request = {}, bomCostById = new Map()) => {
  const bomAmount = bomCostById.get(String(request.consolidatedBOMId)) ?? null
  return buildShipperAmountComparison(bomAmount, request.quoteValue)
}

module.exports = {
  buildShipperAmountComparison,
  buildAmountComparisonForRequest,
  loadConsolidatedBomCostMap,
  normalizeAmount,
}
