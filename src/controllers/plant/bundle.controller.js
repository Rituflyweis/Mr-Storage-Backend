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
  weight: item.weight,
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

const buildItemFromVendorLine = (vendorLine, overrides = {}, existingSnapshot = null) => {
  const resolvedWeight = overrides.weight ?? vendorLine.weight
  const weightMissing =
    overrides.weightMissing ??
    existingSnapshot?.weightMissing ??
    (!Number.isFinite(Number(resolvedWeight)) || Number(resolvedWeight) <= 0)

  const qty =
    overrides.qty != null
      ? Number(overrides.qty)
      : vendorLine.pieceQty != null && Number(vendorLine.pieceQty) > 0
        ? Number(vendorLine.pieceQty)
        : Number(vendorLine.qty || 0)

  const weight = weightMissing ? 0 : Number(overrides.weight ?? vendorLine.weight ?? 0)

  return {
    vendorQuoteLineId: vendorLine._id,
    partCode: overrides.partCode ?? vendorLine.partCode ?? vendorLine.vendorProductCode ?? '',
    description: overrides.description ?? vendorLine.description ?? '',
    category: overrides.category ?? vendorLine.category ?? '',
    color: overrides.color ?? vendorLine.color ?? '',
    qty,
    lengthFeet: overrides.lengthFeet ?? vendorLine.lengthFeet ?? null,
    widthFeet: overrides.widthFeet ?? vendorLine.widthFeet ?? null,
    heightFeet: overrides.heightFeet ?? vendorLine.heightFeet ?? null,
    weight,
    markIds: overrides.markIds ?? (vendorLine.pieceMark ? [vendorLine.pieceMark] : []),
    sourceLineSnapshot:
      existingSnapshot ||
      {
        _id: vendorLine._id,
        vendorLineNo: vendorLine.vendorLineNo,
        extractionFormat: vendorLine.extractionFormat,
        qty: vendorLine.qty,
        pieceQty: vendorLine.pieceQty,
        totalLinearFeet: vendorLine.totalLinearFeet,
        uom: vendorLine.uom,
        partCode: vendorLine.partCode,
        vendorProductCode: vendorLine.vendorProductCode,
        description: vendorLine.description,
        color: vendorLine.color,
        lengthText: vendorLine.lengthText,
        lengthFeet: vendorLine.lengthFeet,
        weight: vendorLine.weight,
        weightMissing,
        pieceMark: vendorLine.pieceMark,
        warnings: vendorLine.warnings || [],
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

    return buildItemFromVendorLine(vendorLine, { ...item, qty }, existing?.sourceLineSnapshot)
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

  const access = await assertPlantProjectAccess(leadId, req.user._id)
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

  const access = await assertPlantProjectAccess(bundle.leadId, req.user._id)
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

  const access = await assertPlantProjectAccess(bundle.leadId, req.user._id)
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

  const access = await assertPlantProjectAccess(bundle.leadId, req.user._id)
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
