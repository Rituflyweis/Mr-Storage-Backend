const Bundle = require('../../models/Bundle')
const BundlePlan = require('../../models/BundlePlan')
const PackingListPlan = require('../../models/PackingListPlan')
const VendorQuoteLine = require('../../models/VendorQuoteLine')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const {
  recalculateBundleMetrics,
  aggregateBundlePlanSummary,
} = require('../../services/plant/loadPlanning.service')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const BUNDLE_TYPES = ['panels', 'trim', 'framing', 'fasteners', 'accessories', 'mixed', 'custom']
const STACK_LEVELS = ['bottom', 'middle', 'top', 'any']

const hasValue = (value) => value !== undefined && value !== null && value !== ''

const toNumber = (value, fallback = 0) => {
  if (!hasValue(value)) return fallback

  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const roundNumber = (value, decimals = 4) => {
  const n = toNumber(value, 0)
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const n = toNumber(value, 0)
    if (n > 0) return n
  }

  return 0
}

const getPlainSubdoc = (value) => {
  if (!value) return null
  if (typeof value.toObject === 'function') return value.toObject()
  return value
}

const getItemTotalWeight = (item) => Number(item?.totalWeight ?? item?.weight ?? 0)

const mapBundleSummaryRow = (bundle) => ({
  _id: bundle._id,
  bundleNo: bundle.bundleNo,
  bundleType: bundle.bundleType,
  title: bundle.title || '',
  totalQty: bundle.totalQty,
  totalWeight: bundle.totalWeight,
  maxLengthFeet: bundle.maxLengthFeet,
  itemCount: bundle.items?.length || 0,
  warnings: bundle.warnings || [],
  stacking: {
    stackLevel: bundle.stacking?.stackLevel,
    canStackOnTop: bundle.stacking?.canStackOnTop,
    canHaveItemsStackedOnIt: bundle.stacking?.canHaveItemsStackedOnIt,
    isFragile: bundle.stacking?.isFragile,
    mustStayFlat: bundle.stacking?.mustStayFlat,
    keepDry: bundle.stacking?.keepDry,
    requiresEdgeProtection: bundle.stacking?.requiresEdgeProtection,
    loadingPriority: bundle.stacking?.loadingPriority,
    unloadingPriority: bundle.stacking?.unloadingPriority,
    stackingNotes: bundle.stacking?.stackingNotes || '',
  },
  loadSequence: bundle.loadSequence,
  status: bundle.status,
})

const mapBundleItemRow = (item) => ({
  _id: item._id,
  vendorQuoteLineId: item.vendorQuoteLineId,
  partCode: item.partCode || '',
  description: item.description || '',
  category: item.category || '',
  color: item.color || '',
  qty: item.qty,
  lengthFeet: item.lengthFeet,
  widthFeet: item.widthFeet,
  heightFeet: item.heightFeet,

  // Backward compatible total line weight.
  weight: item.weight || 0,

  // New clear fields.
  unitWeight: item.unitWeight || 0,
  totalWeight: item.totalWeight ?? item.weight ?? 0,
  weightBasis: item.weightBasis || item.sourceLineSnapshot?.weightBasis || '',
  weightSource: item.weightSource || item.sourceLineSnapshot?.weightSource || '',

  markIds: item.markIds || [],
  sourceLineSnapshot: item.sourceLineSnapshot || null,
})

const mapBundleDetail = (bundle) => ({
  _id: bundle._id,
  bundlePlanId: bundle.bundlePlanId,
  leadId: bundle.leadId,
  shipperRequestId: bundle.shipperRequestId,
  bundleNo: bundle.bundleNo,
  bundleType: bundle.bundleType,
  title: bundle.title || '',
  totalQty: bundle.totalQty,
  totalWeight: bundle.totalWeight,
  maxLengthFeet: bundle.maxLengthFeet,
  estimatedWidthFeet: bundle.estimatedWidthFeet,
  estimatedHeightFeet: bundle.estimatedHeightFeet,
  status: bundle.status,
  packingListId: bundle.packingListId,
  stacking: bundle.stacking,
  loadSequence: bundle.loadSequence,
  handlingInstruction: bundle.handlingInstruction || '',
  warnings: bundle.warnings || [],
  notes: bundle.notes || '',
  createdAt: bundle.createdAt,
  updatedAt: bundle.updatedAt,
})

const assertBundlePlanEditable = async (bundlePlanId) => {
  const bundlePlan = await BundlePlan.findById(bundlePlanId)
  if (!bundlePlan) return { error: 'Bundle plan not found', code: 404 }

  if (bundlePlan.status === 'confirmed') {
    return { error: 'Cannot edit bundles on a confirmed bundle plan', code: 400 }
  }

  const packingListPlan = await PackingListPlan.findOne({
    bundlePlanId: bundlePlan._id,
    status: { $ne: 'cancelled' },
  })
    .select('_id status')
    .lean()

  if (packingListPlan) {
    return {
      error: 'Cannot edit bundles because a packing list / truck plan already exists. Cancel or reset it first.',
      code: 400,
      packingListPlanId: packingListPlan._id,
    }
  }

  return { bundlePlan }
}

const buildItemFromVendorLine = (vendorLine, overrides = {}, existingItem = null) => {
  const existing = getPlainSubdoc(existingItem) || {}
  const existingSnapshot = existing.sourceLineSnapshot || {}

  const qty =
    hasValue(overrides.qty)
      ? Number(overrides.qty)
      : vendorLine.pieceQty != null && Number(vendorLine.pieceQty) > 0
        ? Number(vendorLine.pieceQty)
        : Number(vendorLine.qty || 0)

  const existingTotalWeight = firstPositiveNumber(
    existing.totalWeight,
    existing.weight,
    existingSnapshot.totalWeight,
    existingSnapshot.resolvedWeight,
    existingSnapshot.bomMatchedTotalWeight
  )

  const existingUnitWeight = firstPositiveNumber(
    existing.unitWeight,
    existingSnapshot.unitWeight,
    existingSnapshot.bomMatchedUnitWeight
  )

  const incomingTotalWeight = firstPositiveNumber(
    overrides.totalWeight,
    overrides.weight
  )

  const incomingUnitWeight = firstPositiveNumber(
    overrides.unitWeight
  )

  let unitWeight = 0
  let totalWeight = 0

  // 1. Prefer explicitly sent unitWeight.
  if (incomingUnitWeight > 0) {
    unitWeight = roundNumber(incomingUnitWeight, 6)
  } else if (existingUnitWeight > 0) {
    // 2. Preserve existing unitWeight if frontend did not send it.
    unitWeight = roundNumber(existingUnitWeight, 6)
  }

  // 1. Prefer explicitly sent totalWeight/weight.
  if (incomingTotalWeight > 0) {
    totalWeight = roundNumber(incomingTotalWeight, 4)
  } else if (unitWeight > 0 && qty > 0) {
    // 2. If qty changed, recalculate from preserved unit weight.
    totalWeight = roundNumber(unitWeight * qty, 4)
  } else if (existingTotalWeight > 0) {
    // 3. Preserve existing generated total weight.
    totalWeight = roundNumber(existingTotalWeight, 4)
  } else {
    // 4. Last fallback only. VendorQuoteLine.weight is usually null for Central States.
    totalWeight = firstPositiveNumber(
      vendorLine.totalWeight,
      vendorLine.weight
    )
  }

  if (unitWeight <= 0 && totalWeight > 0 && qty > 0) {
    unitWeight = roundNumber(totalWeight / qty, 6)
  }

  const weightMissing = totalWeight <= 0

  const weightBasis =
    overrides.weightBasis ||
    existing.weightBasis ||
    existingSnapshot.weightBasis ||
    (totalWeight > 0 ? 'BOM_MATCHED_TOTAL_WEIGHT' : 'MISSING')

  const weightSource =
    overrides.weightSource ||
    existing.weightSource ||
    existingSnapshot.weightSource ||
    existingSnapshot.bomMatchedWeightSource ||
    ''

  return {
    vendorQuoteLineId: vendorLine._id,

    partCode: overrides.partCode ?? existing.partCode ?? vendorLine.partCode ?? vendorLine.vendorProductCode ?? '',
    description: overrides.description ?? existing.description ?? vendorLine.description ?? '',
    category: overrides.category ?? existing.category ?? vendorLine.category ?? '',
    color: overrides.color ?? existing.color ?? vendorLine.color ?? '',

    qty,

    lengthFeet: overrides.lengthFeet ?? existing.lengthFeet ?? vendorLine.lengthFeet ?? null,
    widthFeet: overrides.widthFeet ?? existing.widthFeet ?? vendorLine.widthFeet ?? null,
    heightFeet: overrides.heightFeet ?? existing.heightFeet ?? vendorLine.heightFeet ?? null,

    // Backward compatibility: keep this as total line weight.
    weight: totalWeight,

    // Clear fields for UI/API.
    unitWeight,
    totalWeight,
    weightBasis,
    weightSource,

    markIds: overrides.markIds ?? existing.markIds ?? (vendorLine.pieceMark ? [vendorLine.pieceMark] : []),

    sourceLineSnapshot: {
      ...existingSnapshot,

      _id: existingSnapshot._id || vendorLine._id,
      vendorLineNo: existingSnapshot.vendorLineNo || vendorLine.vendorLineNo,
      extractionFormat: existingSnapshot.extractionFormat || vendorLine.extractionFormat,

      qty: vendorLine.qty,
      pieceQty: vendorLine.pieceQty,
      totalLinearFeet: vendorLine.totalLinearFeet,
      safeTotalLinearFeet: existingSnapshot.safeTotalLinearFeet,
      uom: vendorLine.uom,

      partCode: vendorLine.partCode,
      vendorProductCode: vendorLine.vendorProductCode,
      description: vendorLine.description,
      color: vendorLine.color,

      lengthText: vendorLine.lengthText,
      lengthFeet: vendorLine.lengthFeet,
      reportedLengthFeet: existingSnapshot.reportedLengthFeet ?? vendorLine.lengthFeet,
      shippingLengthFeet: existingSnapshot.shippingLengthFeet ?? vendorLine.lengthFeet,

      weight: vendorLine.weight,
      rawWeight: existingSnapshot.rawWeight ?? 0,
      resolvedWeight: totalWeight,
      unitWeight,
      totalWeight,

      weightMultiplier: existingSnapshot.weightMultiplier ?? 1,
      weightBasis,
      weightConfidence: existingSnapshot.weightConfidence ?? (totalWeight > 0 ? 1 : 0),
      weightMissing,
      weightWarnings: weightMissing ? ['Missing/zero physical weight.'] : [],
      weightSource,

      bomMatchedTotalWeight: existingSnapshot.bomMatchedTotalWeight ?? totalWeight,
      bomMatchedUnitWeight: existingSnapshot.bomMatchedUnitWeight ?? unitWeight,
      matchedBomItemIds: existingSnapshot.matchedBomItemIds || [],

      unitPrice: vendorLine.unitPrice,
      priceUnit: vendorLine.priceUnit,
      amount: vendorLine.amount,

      pieceMark: vendorLine.pieceMark,
      warnings: existingSnapshot.warnings || vendorLine.warnings || [],
    },
  }
}

const normalizeIncomingBundleItems = async (incomingItems, existingItems, shipperRequestId) => {
  if (!Array.isArray(incomingItems)) {
    throw new Error('items must be an array')
  }

  const existingByVendorLineId = new Map(
    (existingItems || []).map((item) => [String(item.vendorQuoteLineId), item])
  )

  const vendorLineIds = [
    ...new Set(
      incomingItems
        .map((item) => item.vendorQuoteLineId)
        .filter(Boolean)
        .map(String)
    ),
  ]

  if (vendorLineIds.length !== incomingItems.length) {
    throw new Error('Each item must include a valid vendorQuoteLineId')
  }

  const vendorLines = await VendorQuoteLine.find({
    _id: { $in: vendorLineIds },
    shipperRequestId,
  }).lean()

  const vendorLineMap = new Map(vendorLines.map((line) => [String(line._id), line]))

  return incomingItems.map((item) => {
    const lineId = String(item.vendorQuoteLineId)
    const vendorLine = vendorLineMap.get(lineId)

    if (!vendorLine) {
      throw new Error(`Vendor quote line ${lineId} not found for this shipper request`)
    }

    const qty = Number(item.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid qty for vendor quote line ${lineId}`)
    }

    const existing = existingByVendorLineId.get(lineId)

    // Important:
    // Pass the full existing item, not only sourceLineSnapshot.
    // This preserves existing weight/unitWeight/totalWeight during edits.
    return buildItemFromVendorLine(vendorLine, { ...item, qty }, existing)
  })
}

const syncBundlePlanTotals = async (bundlePlanId) => {
  const bundles = await Bundle.find({ bundlePlanId }).lean()
  const summary = aggregateBundlePlanSummary(bundles)

  await BundlePlan.findByIdAndUpdate(bundlePlanId, {
    totalBundles: summary.totalBundles,
    totalWeight: summary.totalWeight,
    maxLengthFeet: summary.maxLengthFeet,
    warnings: summary.warnings,
  })

  return summary
}

exports.getProjectBundlePlan = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const access = await assertPlantProjectAccess(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const bundlePlan = await BundlePlan.findOne({
    leadId,
    status: { $ne: 'cancelled' },
  })
    .sort({ updatedAt: -1 })
    .lean()

  if (!bundlePlan) {
    return notFound(res, 'No bundle plan found for this project')
  }

  const bundles = await Bundle.find({ bundlePlanId: bundlePlan._id })
    .sort({ loadSequence: 1, bundleNo: 1 })
    .lean()

  const summary = aggregateBundlePlanSummary(bundles)

  return success(res, {
    bundlePlan: {
      _id: bundlePlan._id,
      leadId: bundlePlan.leadId,
      shipperRequestId: bundlePlan.shipperRequestId,
      vendorId: bundlePlan.vendorId,
      planNumber: bundlePlan.planNumber,
      status: bundlePlan.status,
      totalSourceItems: bundlePlan.totalSourceItems,
      totalBundles: bundlePlan.totalBundles,
      totalWeight: bundlePlan.totalWeight,
      maxLengthFeet: bundlePlan.maxLengthFeet,
      warnings: bundlePlan.warnings || [],
      notes: bundlePlan.notes || '',
      generatedBy: bundlePlan.generatedBy,
      confirmedBy: bundlePlan.confirmedBy,
      confirmedAt: bundlePlan.confirmedAt,
      createdAt: bundlePlan.createdAt,
      updatedAt: bundlePlan.updatedAt,
    },
    bundles: bundles.map(mapBundleSummaryRow),
    summary,
  })
})

exports.getBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId).lean()
  if (!bundle) return notFound(res, 'Bundle not found')

  const access = await assertPlantProjectAccess(bundle.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  return success(res, {
    bundle: mapBundleDetail(bundle),
    items: (bundle.items || []).map(mapBundleItemRow),
  })
})

exports.getBundlePublic = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId).lean()
  if (!bundle) return notFound(res, 'Bundle not found')

  return success(res, {
    bundle: mapBundleDetail(bundle),
    items: (bundle.items || []).map(mapBundleItemRow),
  })
})

exports.updateBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  const access = await assertPlantProjectAccess(bundle.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const planCheck = await assertBundlePlanEditable(bundle.bundlePlanId)
  if (planCheck.error) {
    if (planCheck.code === 404) return notFound(res, planCheck.error)
    return badRequest(res, planCheck.error, {
      packingListPlanId: planCheck.packingListPlanId,
    })
  }

  const {
    items,
    bundleType,
    title,
    stacking,
    loadSequence,
    handlingInstruction,
    notes,
  } = req.body

  if (bundleType !== undefined) {
    if (!BUNDLE_TYPES.includes(bundleType)) {
      return badRequest(res, `bundleType must be one of: ${BUNDLE_TYPES.join(', ')}`)
    }
    bundle.bundleType = bundleType
  }

  if (title !== undefined) bundle.title = String(title).trim()
  if (loadSequence !== undefined) bundle.loadSequence = loadSequence == null ? null : Number(loadSequence)
  if (handlingInstruction !== undefined) bundle.handlingInstruction = String(handlingInstruction).trim()
  if (notes !== undefined) bundle.notes = String(notes).trim()

  if (stacking !== undefined) {
    if (stacking.stackLevel != null && !STACK_LEVELS.includes(stacking.stackLevel)) {
      return badRequest(res, `stacking.stackLevel must be one of: ${STACK_LEVELS.join(', ')}`)
    }

    bundle.stacking = {
      ...(bundle.stacking?.toObject?.() || bundle.stacking || {}),
      ...stacking,
    }
  }

  if (items !== undefined) {
    try {
      bundle.items = await normalizeIncomingBundleItems(
        items,
        bundle.items,
        bundle.shipperRequestId
      )
    } catch (err) {
      return badRequest(res, err.message)
    }
  }

  const recalculated = recalculateBundleMetrics(bundle.toObject())
  bundle.totalQty = recalculated.totalQty
  bundle.totalWeight = recalculated.totalWeight
  bundle.maxLengthFeet = recalculated.maxLengthFeet
  bundle.estimatedWidthFeet = recalculated.estimatedWidthFeet
  bundle.estimatedHeightFeet = recalculated.estimatedHeightFeet
  bundle.warnings = recalculated.warnings

  await bundle.save()

  const summary = await syncBundlePlanTotals(bundle.bundlePlanId)
  const saved = await Bundle.findById(bundle._id).lean()

  return success(res, {
    bundle: mapBundleDetail(saved),
    items: (saved.items || []).map(mapBundleItemRow),
    bundlePlanSummary: summary,
  })
})

exports.deleteBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId).lean()
  if (!bundle) return notFound(res, 'Bundle not found')

  const access = await assertPlantProjectAccess(bundle.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const planCheck = await assertBundlePlanEditable(bundle.bundlePlanId)
  if (planCheck.error) {
    if (planCheck.code === 404) return notFound(res, planCheck.error)
    return badRequest(res, planCheck.error, {
      packingListPlanId: planCheck.packingListPlanId,
    })
  }

  if (bundle.packingListId) {
    return badRequest(res, 'Cannot delete a bundle already assigned to a packing list')
  }

  await Bundle.findByIdAndDelete(bundle._id)

  const summary = await syncBundlePlanTotals(bundle.bundlePlanId)

  return success(res, {
    deletedBundleId: bundle._id,
    bundlePlanSummary: summary,
  }, 'Bundle deleted')
})