const PackingList = require('../../models/PackingList')
const PackingListPlan = require('../../models/PackingListPlan')
const Bundle = require('../../models/Bundle')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { TRUCK_TYPES } = require('../../services/plant/loadPlanning.service')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const truckConfigByType = {
  SEMI_53: TRUCK_TYPES.SEMI_53,
  HOTSHOT_40: TRUCK_TYPES.HOTSHOT_40,
}

const summarizePackingListFromBundles = (bundles, packingList) => {
  const totalBundles = bundles.length
  const totalItems = bundles.reduce((sum, b) => sum + ((b.items || []).length), 0)
  const totalWeight = bundles.reduce((sum, b) => sum + Number(b.totalWeight || 0), 0)
  const maxLengthFeet = bundles.reduce((max, b) => Math.max(max, Number(b.maxLengthFeet || 0)), 0)

  const warnings = []
  if (totalWeight > (packingList.maxTruckWeight || 0)) {
    warnings.push(`Truck exceeds safe weight capacity by ${totalWeight - packingList.maxTruckWeight} lbs`)
  }
  if ((packingList.hardMaxTruckWeight || 0) && totalWeight > packingList.hardMaxTruckWeight) {
    warnings.push(`Truck exceeds hard maximum weight by ${totalWeight - packingList.hardMaxTruckWeight} lbs`)
  }
  if ((packingList.maxTruckWeight || 0) > 0 && totalWeight > packingList.maxTruckWeight * 0.95) {
    warnings.push('Truck is above 95% safe capacity')
  }
  if (maxLengthFeet > (packingList.maxTruckLengthFeet || 0)) {
    warnings.push(`Bundle length exceeds truck length by ${maxLengthFeet - packingList.maxTruckLengthFeet} ft`)
  }
  for (const bundle of bundles) {
    warnings.push(...(bundle.warnings || []).map((w) => `${bundle.bundleNo}: ${w}`))
  }

  return {
    totalBundles,
    totalItems,
    totalWeight,
    maxLengthFeet,
    warnings: [...new Set(warnings)],
  }
}

const syncPackingListPlanSummary = async (packingListPlanId) => {
  const rows = await PackingList.find({ packingListPlanId }).lean()
  const summary = {
    totalPackingLists: rows.length,
    totalBundles: rows.reduce((sum, row) => sum + Number(row.totalBundles || 0), 0),
    totalWeight: rows.reduce((sum, row) => sum + Number(row.totalWeight || 0), 0),
    maxLengthFeet: rows.reduce((max, row) => Math.max(max, Number(row.maxLengthFeet || 0)), 0),
    warnings: [...new Set(rows.flatMap((row) => row.warnings || []))],
  }

  summary.truckSummary = {
    semi53Count: rows.filter((row) => row.truckType === 'SEMI_53').length,
    hotshot40Count: rows.filter((row) => row.truckType === 'HOTSHOT_40').length,
    totalTrucks: rows.length,
  }

  await PackingListPlan.findByIdAndUpdate(packingListPlanId, summary)
  return summary
}

exports.getPackingList = asyncHandler(async (req, res) => {
  const packingList = await PackingList.findById(req.params.packingListId).lean()
  if (!packingList) return notFound(res, 'Packing list not found')

  const access = await assertPlantProjectAccess(packingList.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const bundles = await Bundle.find({ _id: { $in: packingList.bundleIds || [] } })
    .select('_id bundleNo bundleType title totalQty totalWeight maxLengthFeet items warnings stacking loadSequence notes')
    .lean()

  const plan = await PackingListPlan.findById(packingList.packingListPlanId).select('_id status').lean()

  return success(res, {
    packingList,
    truckInfo: {
      truckType: packingList.truckType,
      truckLabel: packingList.truckLabel,
      totalWeight: packingList.totalWeight,
      maxTruckWeight: packingList.maxTruckWeight,
      hardMaxTruckWeight: packingList.hardMaxTruckWeight,
      maxTruckLengthFeet: packingList.maxTruckLengthFeet,
    },
    bundles,
    loadLayout: packingList.loadLayout,
    planStatus: plan?.status || 'generated',
  })
})

exports.updatePackingList = asyncHandler(async (req, res) => {
  const packingList = await PackingList.findById(req.params.packingListId)
  if (!packingList) return notFound(res, 'Packing list not found')

  const access = await assertPlantProjectAccess(packingList.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const plan = await PackingListPlan.findById(packingList.packingListPlanId)
  if (!plan) return notFound(res, 'Packing list plan not found')
  if (plan.status === 'confirmed') {
    return badRequest(res, 'Cannot edit packing list after plan is confirmed')
  }

  const { truckType, bundleIds, loadLayout, loadingNotes, overrideReason, notes } = req.body

  if (truckType !== undefined) {
    const cfg = truckConfigByType[truckType]
    if (!cfg) return badRequest(res, 'Invalid truckType')
    packingList.truckType = cfg.truckType
    packingList.truckLabel = cfg.label
    packingList.maxTruckWeight = cfg.maxWeight
    packingList.hardMaxTruckWeight = cfg.hardMaxWeight
    packingList.maxTruckLengthFeet = cfg.maxLengthFeet
  }

  if (loadLayout !== undefined) {
    packingList.loadLayout = {
      ...(packingList.loadLayout?.toObject?.() || packingList.loadLayout || {}),
      ...loadLayout,
    }
  }

  if (loadingNotes !== undefined) {
    packingList.loadLayout = {
      ...(packingList.loadLayout?.toObject?.() || packingList.loadLayout || {}),
      loadingNotes: String(loadingNotes || '').trim(),
    }
  }

  if (overrideReason !== undefined) packingList.overrideReason = String(overrideReason || '').trim()
  if (notes !== undefined) packingList.notes = String(notes || '').trim()

  if (bundleIds !== undefined) {
    const uniqueIds = [...new Set(bundleIds.map(String))]
    const bundles = await Bundle.find({
      _id: { $in: uniqueIds },
      bundlePlanId: plan.bundlePlanId,
    }).select('_id').lean()

    if (bundles.length !== uniqueIds.length) {
      return badRequest(res, 'All bundleIds must belong to this bundle plan')
    }

    packingList.bundleIds = uniqueIds
  }

  const selectedBundles = await Bundle.find({
    _id: { $in: packingList.bundleIds || [] },
    bundlePlanId: plan.bundlePlanId,
  }).lean()

  const recalculated = summarizePackingListFromBundles(selectedBundles, packingList)
  packingList.totalBundles = recalculated.totalBundles
  packingList.totalItems = recalculated.totalItems
  packingList.totalWeight = recalculated.totalWeight
  packingList.maxLengthFeet = recalculated.maxLengthFeet
  packingList.warnings = recalculated.warnings

  await packingList.save()

  if (bundleIds !== undefined) {
    await Bundle.updateMany(
      { bundlePlanId: plan.bundlePlanId, packingListId: packingList._id, _id: { $nin: packingList.bundleIds || [] } },
      { packingListId: null }
    )
    await Bundle.updateMany(
      { bundlePlanId: plan.bundlePlanId, _id: { $in: packingList.bundleIds || [] } },
      { packingListId: packingList._id, status: 'assigned_to_truck' }
    )
    await PackingList.updateMany(
      { packingListPlanId: plan._id, _id: { $ne: packingList._id } },
      { $pull: { bundleIds: { $in: packingList.bundleIds || [] } } }
    )
  }

  const summary = await syncPackingListPlanSummary(plan._id)
  const saved = await PackingList.findById(packingList._id).lean()

  return success(res, {
    packingList: saved,
    packingListPlanSummary: summary,
  })
})
