const PackingList = require('../../models/PackingList')
const PackingListPlan = require('../../models/PackingListPlan')
const Bundle = require('../../models/Bundle')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')
const {
  mapProjectNameFallbackFields,
  LEAD_PROJECT_LIST_SELECT,
  LEAD_PROJECT_LIST_POPULATE,
} = require('../../utils/plantProjectListFields')
const { TRUCK_TYPES } = require('../../services/plant/loadPlanning.service')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { generatePackingListDetailPdf } = require('../../utils/exportDelivery')
const { generatePackingListExcel } = require('../../utils/exportPackingLists')

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

const getAssignedLeadIds = async (req) => getScopedLeadIds(req)

exports.getPackingListPlanProjects = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req)
  if (!leadIds.length) return success(res, { projects: [], total: 0 })

  const plans = await PackingListPlan.find({
    leadId: { $in: leadIds },
    status: { $ne: 'cancelled' },
  })
    .populate({
      path: 'leadId',
      select: LEAD_PROJECT_LIST_SELECT,
      populate: LEAD_PROJECT_LIST_POPULATE,
    })
    .sort({ updatedAt: -1 })
    .lean()

  if (!plans.length) return success(res, { projects: [], total: 0 })

  const projectMap = new Map()

  // plans is sorted by updatedAt desc, so the first plan seen per lead is the latest
  for (const plan of plans) {
    const lead = plan.leadId
    if (!lead?._id) continue
    const key = String(lead._id)
    if (projectMap.has(key)) continue

    projectMap.set(key, {
      leadId: lead._id,
      projectId: lead.jobId || '',
      jobId: lead.jobId || '',
      projectName: lead.projectName || '',
      ...mapProjectNameFallbackFields(lead),
      packingListPlanId: plan._id,
      listGeneratedAt: plan.createdAt || null,
      totalPackingList: plan.totalPackingLists || 0,
      status: plan.status,
      updatedAt: plan.updatedAt,
    })
  }

  let projects = [...projectMap.values()].sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
    return bTime - aTime
  })

  const { search, page = 1, limit = 20 } = req.query
  if (search?.trim()) {
    const term = search.trim().toLowerCase()
    projects = projects.filter((p) =>
      p.projectName?.toLowerCase().includes(term) || p.jobId?.toLowerCase().includes(term)
    )
  }
  const total = projects.length
  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20))
  const paged = projects.slice((parsedPage - 1) * parsedLimit, (parsedPage - 1) * parsedLimit + parsedLimit)

  return success(res, { projects: paged, total, page: parsedPage, limit: parsedLimit })
})

exports.getPackingList = asyncHandler(async (req, res) => {
  const packingList = await PackingList.findById(req.params.packingListId).lean()
  if (!packingList) return notFound(res, 'Packing list not found')

  const access = await assertPlantProjectAccess(packingList.leadId, req)
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

  const access = await assertPlantProjectAccess(packingList.leadId, req)
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

// GET /:packingListId/download-pdf — same generator construction uses, now reachable on plant too.
exports.downloadPackingListPdf = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.packingListId)
    .populate({
      path: 'packingListPlanId',
      select: 'leadId',
      populate: { path: 'leadId', select: 'projectName jobId location' },
    })
    .populate('bundleIds', 'bundleNo bundleType totalQty totalWeight status')
    .lean()
  if (!pl) return notFound(res, 'Packing list not found')

  const access = await assertPlantProjectAccess(pl.packingListPlanId?.leadId?._id, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const mapped = {
    packingListNo: pl.packingListNo,
    truck: pl.truckLabel || pl.truckType,
    destination: pl.packingListPlanId?.leadId?.location || '',
    totalBundles: pl.totalBundles,
    totalWeight: pl.totalWeight,
    maxLengthFeet: pl.maxLengthFeet,
    status: pl.status,
    project: pl.packingListPlanId?.leadId
      ? { projectName: pl.packingListPlanId.leadId.projectName, jobId: pl.packingListPlanId.leadId.jobId }
      : null,
  }

  const buffer = await generatePackingListDetailPdf(mapped, pl.bundleIds || [])
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="packing-list-${pl.packingListNo || pl._id}.pdf"`)
  return res.send(buffer)
})

// GET /export — Export Excel (list-level) on the plant Packing List screen
exports.exportPackingListsExcel = asyncHandler(async (req, res) => {
  const { status } = req.query
  const leadIds = await getScopedLeadIds(req)
  if (!leadIds.length) return res.status(200).end()

  const plans = await PackingListPlan.find({ leadId: { $in: leadIds } }).select('_id').lean()
  const planIds = plans.map((p) => p._id)

  const filter = { packingListPlanId: { $in: planIds } }
  if (status) filter.status = status

  const lists = await PackingList.find(filter)
    .select('packingListNo truckType truckLabel totalBundles totalWeight status packingListPlanId')
    .populate({
      path: 'packingListPlanId',
      select: 'leadId',
      populate: { path: 'leadId', select: 'projectName jobId location' },
    })
    .sort({ createdAt: -1 })
    .lean()

  const rows = lists.map((pl) => ({
    packingListNo: pl.packingListNo,
    truck: pl.truckLabel || pl.truckType,
    totalBundles: pl.totalBundles,
    totalWeight: pl.totalWeight,
    destination: pl.packingListPlanId?.leadId?.location || '',
    status: pl.status,
    project: pl.packingListPlanId?.leadId ? { projectName: pl.packingListPlanId.leadId.projectName } : null,
  }))

  const buffer = await generatePackingListExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="packing-lists.xlsx"')
  return res.send(buffer)
})
