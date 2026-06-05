const BundlePlan = require('../../models/BundlePlan')
const Bundle = require('../../models/Bundle')
const VendorQuoteLine = require('../../models/VendorQuoteLine')
const PackingListPlan = require('../../models/PackingListPlan')
const PackingList = require('../../models/PackingList')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const {
  TRUCK_TYPES,
  generateMixedTruckPackingLists,
  aggregateBundlePlanSummary,
} = require('../../services/plant/loadPlanning.service')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const countForTruckType = (packingLists, type) =>
  packingLists.filter((pl) => pl.truckType === type).length

const buildPackingListPlanSummary = (packingLists = []) => {
  const totalPackingLists = packingLists.length

  const totalBundles = packingLists.reduce(
    (sum, row) => sum + Number(row.totalBundles || 0),
    0
  )

  const totalWeight = packingLists.reduce(
    (sum, row) => sum + Number(row.totalWeight || 0),
    0
  )

  const maxLengthFeet = packingLists.reduce(
    (max, row) => Math.max(max, Number(row.maxLengthFeet || 0)),
    0
  )

  const warnings = [
    ...new Set(packingLists.flatMap((row) => row.warnings || [])),
  ]

  if (totalWeight <= 0 && totalPackingLists > 0) {
    warnings.push(
      'Total packing list weight is zero/missing. Truck plan must be manually reviewed.'
    )
  }

  return {
    totalPackingLists,
    totalBundles,
    totalWeight,
    maxLengthFeet,

    truckSummary: {
      semi53Count: countForTruckType(packingLists, 'SEMI_53'),
      hotshot40Count: countForTruckType(packingLists, 'HOTSHOT_40'),
      totalTrucks: totalPackingLists,
    },

    warnings: [...new Set(warnings)],
  }
}

const getNextBundleNo = async (bundlePlanId) => {
  const rows = await Bundle.find({ bundlePlanId }).select('bundleNo').lean()
  const maxN = rows.reduce((max, row) => {
    const m = String(row.bundleNo || '').match(/^B-(\d+)$/)
    if (!m) return max
    return Math.max(max, Number(m[1]))
  }, 0)
  return `B-${String(maxN + 1).padStart(3, '0')}`
}

const getNextPackingListPlanNumber = async () => {
  const latest = await PackingListPlan.findOne({
    planNumber: { $regex: /^PLP-\d+$/ },
  }).sort({ createdAt: -1 }).select('planNumber').lean()

  const current = latest?.planNumber ? Number(String(latest.planNumber).replace('PLP-', '')) : 0
  const next = Number.isFinite(current) ? current + 1 : 1
  return `PLP-${String(next).padStart(4, '0')}`
}

const mapBundleSummaryRow = (bundle) => ({
  _id: bundle._id,
  bundleNo: bundle.bundleNo,
  bundleType: bundle.bundleType,
  title: bundle.title || '',
  totalQty: bundle.totalQty,
  totalWeight: bundle.totalWeight,
  maxLengthFeet: bundle.maxLengthFeet,
  itemCount: bundle.items?.length || 0,
  status: bundle.status,
  packingListId: bundle.packingListId || null,
  warnings: bundle.warnings || [],
  stacking: bundle.stacking || {},
  loadSequence: bundle.loadSequence,
})

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

const getBundleCoverage = (vendorLines, bundles) => {
  const assignedQtyByVendorLine = new Map()

  for (const bundle of bundles) {
    for (const item of bundle.items || []) {
      const key = String(item.vendorQuoteLineId)
      const next = Number(assignedQtyByVendorLine.get(key) || 0) + Number(item.qty || 0)
      assignedQtyByVendorLine.set(key, next)
    }
  }

  const rows = vendorLines.map((line) => {
    const expectedQty = line.pieceQty != null && Number(line.pieceQty) > 0
      ? Number(line.pieceQty)
      : Number(line.qty || 0)
    const assignedQty = Number(assignedQtyByVendorLine.get(String(line._id)) || 0)
    const diff = assignedQty - expectedQty
    return {
      vendorQuoteLineId: line._id,
      partCode: line.partCode || line.vendorProductCode || '',
      description: line.description || '',
      expectedQty,
      assignedQty,
      diff,
      status: diff === 0 ? 'exact' : diff < 0 ? 'unassigned' : 'over_assigned',
    }
  })

  return {
    rows,
    summary: {
      totalVendorLines: rows.length,
      exactCount: rows.filter((r) => r.status === 'exact').length,
      unassignedCount: rows.filter((r) => r.status === 'unassigned').length,
      overAssignedCount: rows.filter((r) => r.status === 'over_assigned').length,
      canConfirm: rows.every((r) => r.status === 'exact'),
    },
  }
}

const loadBundlePlanWithAccess = async (bundlePlanId, plantUserId) => {
  const bundlePlan = await BundlePlan.findById(bundlePlanId).lean()
  if (!bundlePlan) return { error: 'Bundle plan not found', code: 404 }

  const access = await assertPlantProjectAccess(bundlePlan.leadId, plantUserId)
  if (access.error) return access

  return { bundlePlan }
}

exports.getBundlePlan = asyncHandler(async (req, res) => {
  const loaded = await loadBundlePlanWithAccess(req.params.bundlePlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const { bundlePlan } = loaded
  const bundles = await Bundle.find({ bundlePlanId: bundlePlan._id })
    .sort({ loadSequence: 1, bundleNo: 1 })
    .lean()

  const summary = aggregateBundlePlanSummary(bundles)

  return success(res, {
    bundlePlan,
    bundles: bundles.map(mapBundleSummaryRow),
    summary,
  })
})

exports.updateBundlePlan = asyncHandler(async (req, res) => {
  const loaded = await loadBundlePlanWithAccess(req.params.bundlePlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const { notes } = req.body
  const bundlePlan = await BundlePlan.findByIdAndUpdate(
    req.params.bundlePlanId,
    { notes: String(notes || '').trim() },
    { new: true, runValidators: true }
  ).lean()

  return success(res, { bundlePlan })
})

exports.getBundlePlanCoverage = asyncHandler(async (req, res) => {
  const loaded = await loadBundlePlanWithAccess(req.params.bundlePlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const { bundlePlan } = loaded
  const [vendorLines, bundles] = await Promise.all([
    VendorQuoteLine.find({
      shipperRequestId: bundlePlan.shipperRequestId,
      $or: [{ qty: { $gt: 0 } }, { pieceQty: { $gt: 0 } }],
    }).lean(),
    Bundle.find({ bundlePlanId: bundlePlan._id }).lean(),
  ])

  const coverage = getBundleCoverage(vendorLines, bundles)
  return success(res, coverage)
})

exports.createBundle = asyncHandler(async (req, res) => {
  const loaded = await loadBundlePlanWithAccess(req.params.bundlePlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const { bundlePlan } = loaded
  if (bundlePlan.status === 'confirmed') {
    return badRequest(res, 'Cannot add bundles to a confirmed bundle plan')
  }

  const existingPackingListPlan = await PackingListPlan.findOne({
    bundlePlanId: bundlePlan._id,
    status: { $ne: 'cancelled' },
  }).lean()
  if (existingPackingListPlan) {
    return badRequest(res, 'Cannot add bundles after packing list/truck plan is created', {
      packingListPlanId: existingPackingListPlan._id,
    })
  }

  const bundleNo = await getNextBundleNo(bundlePlan._id)
  const bundleType = req.body.bundleType || 'custom'
  const title = req.body.title || `${bundleType.toUpperCase()} Bundle`

  const stacking = {
    stackLevel: 'any',
    canStackOnTop: true,
    canHaveItemsStackedOnIt: true,
    isFragile: false,
    mustStayFlat: false,
    keepDry: false,
    requiresEdgeProtection: false,
    loadingPriority: 50,
    unloadingPriority: 50,
    stackingNotes: '',
  }

  const bundle = await Bundle.create({
    bundlePlanId: bundlePlan._id,
    leadId: bundlePlan.leadId,
    shipperRequestId: bundlePlan.shipperRequestId,
    bundleNo,
    bundleType,
    title,
    items: [],
    stacking,
    loadSequence: null,
    handlingInstruction: '',
    notes: String(req.body.notes || '').trim(),
    warnings: ['Bundle has no valid weight. Truck/load plan is not trustworthy until weight is reviewed.'],
  })

  const summary = await syncBundlePlanTotals(bundlePlan._id)
  return created(res, { bundle, bundlePlanSummary: summary }, 'Bundle created')
})

exports.confirmBundlePlan = asyncHandler(async (req, res) => {
  const loaded = await loadBundlePlanWithAccess(req.params.bundlePlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const bundlePlan = await BundlePlan.findById(req.params.bundlePlanId)
  if (bundlePlan.status === 'confirmed') {
    return success(res, {
      bundlePlanId: bundlePlan._id,
      status: bundlePlan.status,
      confirmedAt: bundlePlan.confirmedAt,
    })
  }

  const [vendorLines, bundles] = await Promise.all([
    VendorQuoteLine.find({
      shipperRequestId: bundlePlan.shipperRequestId,
      $or: [{ qty: { $gt: 0 } }, { pieceQty: { $gt: 0 } }],
    }).lean(),
    Bundle.find({ bundlePlanId: bundlePlan._id }).lean(),
  ])

  if (!bundles.length) {
    return badRequest(res, 'Cannot confirm an empty bundle plan')
  }

  const coverage = getBundleCoverage(vendorLines, bundles)
  if (!coverage.summary.canConfirm) {
    return badRequest(res, 'Bundle coverage is incomplete. Resolve unassigned/over-assigned lines before confirm.', coverage.summary)
  }

  await Promise.all([
    Bundle.updateMany({ bundlePlanId: bundlePlan._id }, { status: 'confirmed' }),
    BundlePlan.findByIdAndUpdate(bundlePlan._id, {
      status: 'confirmed',
      confirmedBy: req.user._id,
      confirmedAt: new Date(),
    }),
  ])

  return success(res, {
    bundlePlanId: bundlePlan._id,
    status: 'confirmed',
    confirmedAt: new Date(),
    summary: coverage.summary,
  }, 'Bundle plan confirmed')
})

exports.generatePackingListPlan = asyncHandler(async (req, res) => {
  const { bundlePlanId } = req.params

  const loaded = await loadBundlePlanWithAccess(bundlePlanId, req.user._id)

  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const bundlePlan = await BundlePlan.findById(bundlePlanId).lean()

  if (!bundlePlan) {
    return notFound(res, 'Bundle plan not found')
  }

  if (bundlePlan.status !== 'confirmed') {
    return badRequest(
      res,
      'Bundle plan must be confirmed before generating packing list plan'
    )
  }

  const existingPlan = await PackingListPlan.findOne({
    bundlePlanId: bundlePlan._id,
  }).lean()

  if (existingPlan?.status === 'confirmed') {
    return badRequest(
      res,
      'Confirmed packing list plan already exists for this bundle plan'
    )
  }

  /**
   * Future safety:
   * When Delivery/Freight bidding module is added, block regeneration if delivery exists.
   */

  const bundles = await Bundle.find({
    bundlePlanId: bundlePlan._id,
    status: 'confirmed',
  })
    .sort({
      loadSequence: 1,
      totalWeight: -1,
      maxLengthFeet: -1,
      createdAt: 1,
    })
    .lean()

  if (!bundles.length) {
    return badRequest(res, 'No confirmed bundles found for this bundle plan')
  }

  const bundlesWithMissingWeight = bundles.filter((bundle) => {
    const totalWeight = Number(bundle.totalWeight || 0)

    return (
      totalWeight <= 0 ||
      (bundle.warnings || []).some((warning) => {
        const text = String(warning || '').toLowerCase()

        return (
          text.includes('missing/zero weight') ||
          text.includes('no valid weight') ||
          text.includes('weight and truck plan may be inaccurate') ||
          text.includes('truck/load plan is not trustworthy')
        )
      })
    )
  })

  const generated = generateMixedTruckPackingLists(bundles)

  if (!generated.length) {
    return badRequest(res, 'No packing lists could be generated from bundles')
  }

  const summary = buildPackingListPlanSummary(generated)

  if (bundlesWithMissingWeight.length > 0) {
    summary.warnings = [
      ...new Set([
        ...(summary.warnings || []),
        `${bundlesWithMissingWeight.length} bundle(s) have missing/zero weight. Truck assignment and total load weight must be manually reviewed.`,
      ]),
    ]
  }

  const planNumber =
    existingPlan?.planNumber || await getNextPackingListPlanNumber()

  let packingListPlan
  const wasRegenerated = Boolean(existingPlan)

  if (existingPlan) {
    packingListPlan = await PackingListPlan.findByIdAndUpdate(
      existingPlan._id,
      {
        status: 'generated',
        planNumber,

        totalPackingLists: summary.totalPackingLists,
        totalBundles: summary.totalBundles,
        totalWeight: summary.totalWeight,
        maxLengthFeet: summary.maxLengthFeet,
        truckSummary: summary.truckSummary,
        warnings: summary.warnings,

        overrideReason: '',
        generatedBy: req.user._id,
        confirmedBy: null,
        confirmedAt: null,
      },
      {
        new: true,
        runValidators: true,
      }
    )

    await PackingList.deleteMany({
      packingListPlanId: packingListPlan._id,
    })
  } else {
    packingListPlan = await PackingListPlan.create({
      leadId: bundlePlan.leadId,
      shipperRequestId: bundlePlan.shipperRequestId,
      bundlePlanId: bundlePlan._id,

      planNumber,
      status: 'generated',

      totalPackingLists: summary.totalPackingLists,
      totalBundles: summary.totalBundles,
      totalWeight: summary.totalWeight,
      maxLengthFeet: summary.maxLengthFeet,
      truckSummary: summary.truckSummary,
      warnings: summary.warnings,

      generatedBy: req.user._id,
    })
  }

  const rowsToInsert = generated.map((row) => ({
    ...row,
    packingListPlanId: packingListPlan._id,
    bundlePlanId: bundlePlan._id,
    leadId: bundlePlan.leadId,
    shipperRequestId: bundlePlan.shipperRequestId,
  }))

  const packingLists = await PackingList.insertMany(rowsToInsert)

  /**
   * During regeneration, reset bundles first.
   * Then assign only bundles that are present in generated packing lists.
   */
  await Bundle.updateMany(
    {
      bundlePlanId: bundlePlan._id,
    },
    {
      $set: {
        packingListId: null,
        status: 'confirmed',
      },
    }
  )

  for (const packingList of packingLists) {
    if (!packingList.bundleIds?.length) continue

    await Bundle.updateMany(
      {
        _id: {
          $in: packingList.bundleIds,
        },
      },
      {
        $set: {
          packingListId: packingList._id,
          status: 'assigned_to_truck',
        },
      }
    )
  }

  const hasWeightWarning = (packingListPlan.warnings || []).some((warning) => {
    const text = String(warning || '').toLowerCase()

    return (
      text.includes('weight') ||
      text.includes('missing') ||
      text.includes('zero')
    )
  })

  const responseData = {
    packingListPlan: {
      _id: packingListPlan._id,
      planNumber: packingListPlan.planNumber,
      status: packingListPlan.status,

      totalPackingLists: packingListPlan.totalPackingLists,
      totalBundles: packingListPlan.totalBundles,
      totalWeight: packingListPlan.totalWeight,
      maxLengthFeet: packingListPlan.maxLengthFeet,

      truckSummary: packingListPlan.truckSummary,

      missingWeightBundleCount: bundlesWithMissingWeight.length,
      hasWeightWarning,

      warnings: packingListPlan.warnings || [],
    },

    packingLists: packingLists.map((row) => ({
      _id: row._id,

      packingListNo: row.packingListNo,
      truckNo: row.truckNo,
      truckType: row.truckType,
      truckLabel: row.truckLabel,

      maxTruckWeight: row.maxTruckWeight,
      hardMaxTruckWeight: row.hardMaxTruckWeight,
      maxTruckLengthFeet: row.maxTruckLengthFeet,

      totalWeight: row.totalWeight,
      maxLengthFeet: row.maxLengthFeet,
      totalBundles: row.totalBundles,
      totalItems: row.totalItems,

      bundleIds: row.bundleIds || [],
      loadLayout: row.loadLayout,

      hasWeightWarning: (row.warnings || []).some((warning) => {
        const text = String(warning || '').toLowerCase()

        return (
          text.includes('weight') ||
          text.includes('missing') ||
          text.includes('zero')
        )
      }),

      warnings: row.warnings || [],
      status: row.status,
    })),

    truckConfig: TRUCK_TYPES,
  }

  if (wasRegenerated) {
    return success(res, responseData, 'Packing list plan regenerated')
  }

  return created(res, responseData, 'Packing list plan generated')
})