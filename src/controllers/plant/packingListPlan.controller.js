const PackingListPlan = require('../../models/PackingListPlan')
const PackingList = require('../../models/PackingList')
const Bundle = require('../../models/Bundle')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const loadPackingListPlanWithAccess = async (packingListPlanId, plantUserId) => {
  const packingListPlan = await PackingListPlan.findById(packingListPlanId).lean()
  if (!packingListPlan) return { error: 'Packing list plan not found', code: 404 }

  const access = await assertPlantProjectAccess(packingListPlan.leadId, plantUserId)
  if (access.error) return access

  return { packingListPlan }
}

exports.getPackingListPlan = asyncHandler(async (req, res) => {
  const loaded = await loadPackingListPlanWithAccess(req.params.packingListPlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const { packingListPlan } = loaded
  const packingLists = await PackingList.find({ packingListPlanId: packingListPlan._id })
    .sort({ truckNo: 1, packingListNo: 1 })
    .lean()

  const summary = {
    totalWeight: packingListPlan.totalWeight,
    totalBundles: packingListPlan.totalBundles,
    totalPackingLists: packingListPlan.totalPackingLists,
    truckSummary: packingListPlan.truckSummary,
    warnings: packingListPlan.warnings || [],
  }

  return success(res, {
    packingListPlan,
    packingLists,
    summary,
  })
})

exports.confirmPackingListPlan = asyncHandler(async (req, res) => {
  const loaded = await loadPackingListPlanWithAccess(req.params.packingListPlanId, req.user._id)
  if (loaded.error) {
    if (loaded.code === 404) return notFound(res, loaded.error)
    return forbidden(res, loaded.error)
  }

  const packingListPlan = await PackingListPlan.findById(req.params.packingListPlanId)
  if (!packingListPlan) return notFound(res, 'Packing list plan not found')
  if (packingListPlan.status === 'confirmed') {
    return success(res, {
      packingListPlanId: packingListPlan._id,
      status: packingListPlan.status,
      confirmedAt: packingListPlan.confirmedAt,
      summary: {
        totalWeight: packingListPlan.totalWeight,
        totalBundles: packingListPlan.totalBundles,
        truckSummary: packingListPlan.truckSummary,
      },
    })
  }

  const [packingLists, bundles] = await Promise.all([
    PackingList.find({ packingListPlanId: packingListPlan._id }).lean(),
    Bundle.find({ bundlePlanId: packingListPlan.bundlePlanId }).select('_id').lean(),
  ])

  if (!packingLists.length) {
    return badRequest(res, 'Cannot confirm empty packing list plan')
  }

  const bundleIdSet = new Set(bundles.map((b) => String(b._id)))
  const usage = new Map()

  for (const row of packingLists) {
    if (!row.truckType) {
      return badRequest(res, `Packing list ${row.packingListNo} has no truckType`)
    }
    if ((row.totalWeight || 0) > (row.hardMaxTruckWeight || row.maxTruckWeight || 0)) {
      return badRequest(res, `Packing list ${row.packingListNo} exceeds hard truck weight limit`)
    }
    if ((row.maxLengthFeet || 0) > (row.maxTruckLengthFeet || 0)) {
      return badRequest(res, `Packing list ${row.packingListNo} exceeds truck length limit`)
    }

    for (const bundleId of row.bundleIds || []) {
      const key = String(bundleId)
      usage.set(key, (usage.get(key) || 0) + 1)
    }
  }

  const unassigned = []
  const duplicated = []
  for (const id of bundleIdSet) {
    const count = usage.get(id) || 0
    if (count === 0) unassigned.push(id)
    if (count > 1) duplicated.push(id)
  }

  if (unassigned.length || duplicated.length) {
    return badRequest(res, 'Bundle assignment validation failed', {
      unassignedBundleIds: unassigned,
      duplicatedBundleIds: duplicated,
    })
  }

  const now = new Date()
  await Promise.all([
    PackingListPlan.findByIdAndUpdate(packingListPlan._id, {
      status: 'confirmed',
      confirmedBy: req.user._id,
      confirmedAt: now,
    }),
    PackingList.updateMany({ packingListPlanId: packingListPlan._id }, { status: 'confirmed' }),
  ])

  return success(res, {
    packingListPlanId: packingListPlan._id,
    status: 'confirmed',
    confirmedAt: now,
    summary: {
      totalWeight: packingListPlan.totalWeight,
      totalBundles: packingListPlan.totalBundles,
      truckSummary: packingListPlan.truckSummary,
    },
  }, 'Packing list plan confirmed')
})
