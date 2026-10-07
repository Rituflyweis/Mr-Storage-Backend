const mongoose = require('mongoose')
const Bundle = require('../../models/Bundle')
const { MISMATCH_ITEM_STATUSES } = require('../../models/Bundle')
const PackingList = require('../../models/PackingList')
const Lead = require('../../models/Lead')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { generatePackingListDetailPdf } = require('../../utils/exportDelivery')
const { generatePackingListExcel } = require('../../utils/exportPackingLists')
const {
  generateBundleLabelsExcel,
  generateBundleScanExcel,
  generateDispatchVerificationExcel,
} = require('../../utils/exportConstructionLogistics')
const {
  BUNDLE_STATUSES,
  PACKING_LIST_STATUSES,
} = require('../../config/constants')
const {
  parseSortBy,
  bundleSortMap,
  packingListSortMap,
  dispatchSortMap,
  bundleScanStatusToDb,
  labelStatusToFilter,
  dispatchVerificationStatusFilter,
  appendLeadProjectSearch,
  appendPackingListSearch,
  CONSTRUCTION_SORT_BY,
  BUNDLE_SCAN_UI_STATUSES,
  LABEL_UI_STATUSES,
  DISPATCH_VERIFICATION_UI_STATUSES,
} = require('../../utils/constructionListQuery')

const resolvePackingListRef = (packingListId) => {
  if (!packingListId) return { packingListId: null, loadId: null, loadLabel: null }
  if (typeof packingListId === 'object' && packingListId._id) {
    const no = packingListId.packingListNo || null
    const truck = packingListId.truckLabel || packingListId.truckNo || null
    return {
      packingListId: packingListId._id,
      loadId: no,
      loadLabel: no && truck ? `${no} (${truck})` : no || truck,
    }
  }
  return { packingListId, loadId: null, loadLabel: null }
}

const mapBundleLabelRow = (b) => {
  const load = resolvePackingListRef(b.packingListId)
  return {
  bundleId: b._id,
  bundleNo: b.bundleNo,
  bundleType: b.bundleType,
  title: b.title,
  parts: b.items?.map((i) => i.partNo || i.itemId).join(', ') || '',
  totalWeight: b.totalWeight,
  maxLengthFeet: b.maxLengthFeet,
  status: b.status,
  labelPrinted: b.labelPrinted || false,
  packingListId: load.packingListId,
  loadId: load.loadId,
  loadLabel: load.loadLabel,
  project: b.bundlePlanId?.leadId
    ? {
        leadId: b.bundlePlanId.leadId._id,
        projectName: b.bundlePlanId.leadId.projectName,
        jobId: b.bundlePlanId.leadId.jobId,
      }
    : null,
}
}

const mapBundleScanRow = (b) => ({
  bundleId: b._id,
  bundleNo: b.bundleNo,
  parts: b.items?.map((i) => i.partNo || i.itemId).join(', ') || '',
  totalWeight: b.totalWeight,
  status: b.status,
  scannedAt: b.updatedAt,
  project: b.bundlePlanId?.leadId
    ? {
        leadId: b.bundlePlanId.leadId._id,
        projectName: b.bundlePlanId.leadId.projectName,
        jobId: b.bundlePlanId.leadId.jobId,
      }
    : null,
})

const mapPackingListRow = (pl) => ({
  packingListId: pl._id,
  packingListNo: pl.packingListNo,
  truck: pl.truckLabel || pl.truckType,
  totalBundles: pl.totalBundles,
  totalWeight: pl.totalWeight,
  destination: pl.deliveryLocation || pl.packingListPlanId?.leadId?.location || '',
  status: pl.status,
  project: pl.packingListPlanId?.leadId
    ? {
        leadId: pl.packingListPlanId.leadId._id,
        projectName: pl.packingListPlanId.leadId.projectName,
        jobId: pl.packingListPlanId.leadId.jobId,
      }
    : null,
})

const mapDispatchRow = (pl) => ({
  loadId: pl._id,
  packingListNo: pl.packingListNo,
  truck: pl.truckLabel || pl.truckType,
  totalBundles: pl.totalBundles,
  bundleIds: pl.bundleIds || [],
  totalWeight: pl.totalWeight,
  destination: pl.deliveryLocation || pl.packingListPlanId?.leadId?.location || '',
  status: pl.status,
  weightVerified: pl.weightVerified || false,
  loadingVerified: pl.loadingVerified || false,
  project: pl.packingListPlanId?.leadId
    ? {
        leadId: pl.packingListPlanId.leadId._id,
        projectName: pl.packingListPlanId.leadId.projectName,
        jobId: pl.packingListPlanId.leadId.jobId,
      }
    : null,
})

const buildLabelFilter = async (query) => {
  const { status, search, leadId } = query
  const filter = {}
  if (leadId) filter.leadId = leadId
  if (status && LABEL_UI_STATUSES.includes(status)) {
    Object.assign(filter, labelStatusToFilter(status))
  } else if (status && BUNDLE_STATUSES.includes(status)) {
    filter.status = status
  }
  await appendLeadProjectSearch(filter, search)
  return filter
}

const buildBundleScanFilter = async (query) => {
  const { status, search, leadId } = query
  const filter = { status: { $in: bundleScanStatusToDb(status) } }
  if (leadId) filter.leadId = leadId
  await appendLeadProjectSearch(filter, search)
  return filter
}

const buildPackingListFilter = async (query) => {
  const { status, search, leadId } = query
  const filter = {}
  if (status) filter.status = status
  if (leadId) filter.leadId = leadId
  appendPackingListSearch(filter, search)
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    const leadIds = await Lead.find({ $or: [{ projectName: regex }, { jobId: regex }] }).distinct('_id')
    const searchOr = filter.$or || []
    if (leadIds.length) searchOr.push({ leadId: { $in: leadIds } })
    if (searchOr.length) filter.$or = searchOr
  }
  return filter
}

const buildDispatchFilter = (query) => {
  const { status, search } = query
  const filter = {
    status: { $in: ['confirmed', 'generated', 'ready', 'loading', 'dispatched'] },
    ...dispatchVerificationStatusFilter(status),
  }
  appendPackingListSearch(filter, search)
  return filter
}

const bundlePopulate = {
  path: 'bundlePlanId',
  select: 'leadId',
  populate: { path: 'leadId', select: 'projectName jobId location' },
}

const packingListPopulate = {
  path: 'packingListPlanId',
  select: 'leadId',
  populate: { path: 'leadId', select: 'projectName jobId location' },
}

exports.getBundleLabels = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy } = req.query
  const filter = await buildLabelFilter(req.query)
  const sort = parseSortBy(sortBy, bundleSortMap)
  const skip = (Number(page) - 1) * Number(limit)

  const [bundles, total] = await Promise.all([
    Bundle.find(filter)
      .select('bundleNo bundleType title totalWeight maxLengthFeet status packingListId bundlePlanId items labelPrinted')
      .populate(bundlePopulate)
      .populate('packingListId', 'packingListNo truckLabel truckNo')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Bundle.countDocuments(filter),
  ])

  const now = new Date()
  const stats = {
    totalBundles: await Bundle.countDocuments({}),
    labelsPrinted: await Bundle.countDocuments({ labelPrinted: true }),
    labelsPending: await Bundle.countDocuments({ labelPrinted: { $ne: true } }),
    labelsPrintedToday: await Bundle.countDocuments({
      labelPrinted: true,
      labelPrintedAt: { $gte: new Date(now.toDateString()) },
    }),
  }

  return success(res, {
    bundles: bundles.map(mapBundleLabelRow),
    total,
    stats,
    page: Number(page),
    limit: Number(limit),
    enums: { sortBy: CONSTRUCTION_SORT_BY, labelStatus: LABEL_UI_STATUSES, bundleStatus: BUNDLE_STATUSES },
  })
})

exports.exportBundleLabels = asyncHandler(async (req, res) => {
  const filter = await buildLabelFilter(req.query)
  const sort = parseSortBy(req.query.sortBy, bundleSortMap)
  const bundles = await Bundle.find(filter)
    .select('bundleNo bundleType title totalWeight status bundlePlanId labelPrinted packingListId')
    .populate(bundlePopulate)
    .populate('packingListId', 'packingListNo truckLabel truckNo')
    .sort(sort)
    .lean()
  const buffer = await generateBundleLabelsExcel(bundles.map(mapBundleLabelRow))
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="bundle-labels.xlsx"')
  return res.send(buffer)
})

exports.printBundleLabels = asyncHandler(async (req, res) => {
  const { bundleIds } = req.body
  if (!Array.isArray(bundleIds) || !bundleIds.length) {
    return badRequest(res, 'bundleIds is required')
  }

  const now = new Date()
  await Bundle.updateMany(
    { _id: { $in: bundleIds } },
    { $set: { labelPrinted: true, labelPrintedAt: now } }
  )

  return success(res, { bundleIds, labelPrinted: true, labelPrintedAt: now }, 'Labels printed')
})

exports.getBundleScanHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy } = req.query
  const filter = await buildBundleScanFilter(req.query)
  const sort =
    sortBy === 'Weight'
      ? { totalWeight: -1 }
      : sortBy === 'Oldest'
        ? { updatedAt: 1 }
        : { updatedAt: -1 }
  const skip = (Number(page) - 1) * Number(limit)

  const [bundles, total] = await Promise.all([
    Bundle.find(filter)
      .select('bundleNo status totalWeight maxLengthFeet updatedAt packingListId bundlePlanId items')
      .populate(bundlePopulate)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Bundle.countDocuments(filter),
  ])

  const stats = {
    bundlesScanned: await Bundle.countDocuments({ status: { $in: ['assigned_to_truck', 'staged'] } }),
    bundlesRemaining: await Bundle.countDocuments({ status: { $in: ['draft', 'confirmed'] } }),
    bundlesLoaded: await Bundle.countDocuments({ status: 'loaded' }),
  }

  return success(res, {
    bundles: bundles.map(mapBundleScanRow),
    total,
    stats,
    page: Number(page),
    limit: Number(limit),
    enums: { sortBy: ['Latest', 'Oldest', 'Weight'], status: BUNDLE_SCAN_UI_STATUSES },
  })
})

exports.exportBundleScan = asyncHandler(async (req, res) => {
  const filter = await buildBundleScanFilter(req.query)
  const sort =
    req.query.sortBy === 'Weight'
      ? { totalWeight: -1 }
      : req.query.sortBy === 'Oldest'
        ? { updatedAt: 1 }
        : { updatedAt: -1 }
  const bundles = await Bundle.find(filter)
    .select('bundleNo status totalWeight updatedAt bundlePlanId')
    .populate(bundlePopulate)
    .sort(sort)
    .lean()
  const buffer = await generateBundleScanExcel(bundles.map(mapBundleScanRow))
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="bundle-scan.xlsx"')
  return res.send(buffer)
})

exports.getPackingLists = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy } = req.query
  const filter = await buildPackingListFilter(req.query)
  const sort = parseSortBy(sortBy, packingListSortMap)
  const skip = (Number(page) - 1) * Number(limit)

  const [lists, total] = await Promise.all([
    PackingList.find(filter)
      .select('packingListNo truckType truckLabel totalBundles totalWeight maxLengthFeet status deliveryLocation packingListPlanId')
      .populate(packingListPopulate)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PackingList.countDocuments(filter),
  ])

  const stats = {
    totalPackingList: await PackingList.countDocuments({}),
    loadsReadyForDispatch: await PackingList.countDocuments({ status: 'confirmed' }),
    bundlesAssigned: await Bundle.countDocuments({ packingListId: { $ne: null } }),
    loadsDispatchedToday: await PackingList.countDocuments({
      status: 'dispatched',
      updatedAt: { $gte: new Date(new Date().toDateString()) },
    }),
  }

  return success(res, {
    packingLists: lists.map(mapPackingListRow),
    total,
    stats,
    page: Number(page),
    limit: Number(limit),
    enums: { sortBy: CONSTRUCTION_SORT_BY, status: PACKING_LIST_STATUSES },
  })
})

exports.getDispatchVerification = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy } = req.query
  const filter = buildDispatchFilter(req.query)
  const sort = parseSortBy(sortBy, dispatchSortMap)
  const skip = (Number(page) - 1) * Number(limit)

  const [lists, total] = await Promise.all([
    PackingList.find(filter)
      .select('packingListNo truckType truckLabel totalBundles totalWeight deliveryLocation status bundleIds packingListPlanId weightVerified loadingVerified')
      .populate(packingListPopulate)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PackingList.countDocuments(filter),
  ])

  const stats = {
    loadsReadyForDispatch: await PackingList.countDocuments({ status: 'confirmed' }),
    bundlesVerified: await Bundle.countDocuments({ verified: true }),
    bundlesMissing: await Bundle.countDocuments({ packingListId: null, status: { $nin: ['draft', 'cancelled'] } }),
    loadsDispatchedToday: await PackingList.countDocuments({
      status: 'dispatched',
      updatedAt: { $gte: new Date(new Date().toDateString()) },
    }),
  }

  return success(res, {
    loads: lists.map(mapDispatchRow),
    total,
    stats,
    page: Number(page),
    limit: Number(limit),
    enums: { sortBy: CONSTRUCTION_SORT_BY, status: DISPATCH_VERIFICATION_UI_STATUSES },
  })
})

exports.exportDispatchVerification = asyncHandler(async (req, res) => {
  const filter = buildDispatchFilter(req.query)
  const sort = parseSortBy(req.query.sortBy, dispatchSortMap)
  const lists = await PackingList.find(filter)
    .select('packingListNo truckType truckLabel totalBundles totalWeight deliveryLocation status packingListPlanId')
    .populate(packingListPopulate)
    .sort(sort)
    .lean()
  const buffer = await generateDispatchVerificationExcel(lists.map(mapDispatchRow))
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="dispatch-verification.xlsx"')
  return res.send(buffer)
})

exports.reprintBundleLabel = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  bundle.labelPrinted = true
  bundle.labelPrintedAt = new Date()
  await bundle.save()

  return success(res, { bundleId: bundle._id, labelPrinted: true }, 'Label reprinted')
})

exports.getBundleDetail = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId)
    .populate({
      path: 'bundlePlanId',
      select: 'leadId',
      populate: { path: 'leadId', select: 'projectName jobId location' },
    })
    .populate('packingListId', 'packingListNo truckLabel truckType deliveryLocation')
    .lean()

  if (!bundle) return notFound(res, 'Bundle not found')

  return success(res, {
    bundle: {
      bundleId: bundle._id,
      bundleNo: bundle.bundleNo,
      bundleType: bundle.bundleType,
      title: bundle.title,
      items: bundle.items || [],
      totalQty: bundle.totalQty,
      totalWeight: bundle.totalWeight,
      maxLengthFeet: bundle.maxLengthFeet,
      status: bundle.status,
      labelPrinted: bundle.labelPrinted || false,
      verified: bundle.verified || false,
      mismatchNotes: bundle.mismatchNotes || '',
      project: bundle.bundlePlanId?.leadId
        ? {
            leadId: bundle.bundlePlanId.leadId._id,
            projectName: bundle.bundlePlanId.leadId.projectName,
            jobId: bundle.bundlePlanId.leadId.jobId,
          }
        : null,
      packingList: bundle.packingListId || null,
    },
  })
})

exports.verifyBundle = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  bundle.verified = true
  bundle.verifiedAt = new Date()
  await bundle.save()

  return success(res, { bundleId: bundle._id, verified: true }, 'Bundle verified')
})

exports.markBundleStaged = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  bundle.status = 'staged'
  await bundle.save()

  return success(res, { bundleId: bundle._id, status: bundle.status }, 'Bundle marked staged')
})

exports.markBundleLoaded = asyncHandler(async (req, res) => {
  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  bundle.status = 'loaded'
  await bundle.save()

  return success(res, { bundleId: bundle._id, status: bundle.status }, 'Bundle marked loaded')
})

exports.reportBundleMismatch = asyncHandler(async (req, res) => {
  const { notes, items } = req.body
  if (!notes) return badRequest(res, 'notes is required')
  if (items !== undefined && !Array.isArray(items)) return badRequest(res, 'items must be an array')

  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  if (items?.length) {
    for (const item of items) {
      if (!item.itemId || !mongoose.Types.ObjectId.isValid(item.itemId)) {
        return badRequest(res, 'Each item requires a valid itemId')
      }
      if (item.status && !MISMATCH_ITEM_STATUSES.includes(item.status)) {
        return badRequest(res, `Invalid status "${item.status}". Use: ${MISMATCH_ITEM_STATUSES.join(', ')}`)
      }
    }
  }

  bundle.mismatchNotes = notes
  bundle.mismatchReportedAt = new Date()
  bundle.mismatchItems = (items || []).map((item) => ({
    itemId: item.itemId,
    partCode: item.partCode || '',
    description: item.description || '',
    qty: item.qty ?? 0,
    receivedQty: item.receivedQty ?? 0,
    status: item.status || 'Not Received',
  }))
  await bundle.save()

  return success(res, {
    bundleId: bundle._id,
    mismatchNotes: bundle.mismatchNotes,
    mismatchReportedAt: bundle.mismatchReportedAt,
    mismatchItems: bundle.mismatchItems,
  }, 'Mismatch reported')
})

exports.getPackingListDetail = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.packingListId)
    .populate({
      path: 'packingListPlanId',
      select: 'leadId',
      populate: { path: 'leadId', select: 'projectName jobId location' },
    })
    .populate(
      'bundleIds',
      'bundleNo bundleType title totalQty totalWeight maxLengthFeet status items labelPrinted verified mismatchNotes stacking'
    )
    .lean()

  if (!pl) return notFound(res, 'Packing list not found')

  return success(res, {
    packingList: {
      packingListId: pl._id,
      packingListNo: pl.packingListNo,
      truck: pl.truckLabel || pl.truckType,
      truckNo: pl.truckNo,
      totalBundles: pl.totalBundles,
      totalItems: pl.totalItems,
      totalWeight: pl.totalWeight,
      maxLengthFeet: pl.maxLengthFeet,
      destination: pl.deliveryLocation || pl.packingListPlanId?.leadId?.location || '',
      status: pl.status,
      loadLayout: pl.loadLayout || null,
      warnings: pl.warnings || [],
      actualWeight: pl.actualWeight,
      weightVerified: pl.weightVerified || false,
      loadingVerified: pl.loadingVerified || false,
      bundles: pl.bundleIds || [],
      project: pl.packingListPlanId?.leadId
        ? {
            leadId: pl.packingListPlanId.leadId._id,
            projectName: pl.packingListPlanId.leadId.projectName,
            jobId: pl.packingListPlanId.leadId.jobId,
          }
        : null,
    },
  })
})

exports.getDispatchVerificationDetail = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.loadId)
    .populate({
      path: 'packingListPlanId',
      select: 'leadId',
      populate: { path: 'leadId', select: 'projectName jobId location' },
    })
    .populate('bundleIds', 'bundleNo bundleType totalWeight status verified')
    .lean()

  if (!pl) return notFound(res, 'Load not found')

  return success(res, {
    load: {
      loadId: pl._id,
      packingListNo: pl.packingListNo,
      truck: pl.truckLabel || pl.truckType,
      destination: pl.deliveryLocation || pl.packingListPlanId?.leadId?.location || '',
      status: pl.status,
      plannedWeight: pl.totalWeight,
      actualWeight: pl.actualWeight,
      weightVerified: pl.weightVerified || false,
      loadingVerified: pl.loadingVerified || false,
      bundles: (pl.bundleIds || []).map((b) => ({
        bundleId: b._id,
        bundleNo: b.bundleNo,
        totalWeight: b.totalWeight,
        status: b.status,
        verified: b.verified || false,
      })),
      project: pl.packingListPlanId?.leadId
        ? {
            leadId: pl.packingListPlanId.leadId._id,
            projectName: pl.packingListPlanId.leadId.projectName,
            jobId: pl.packingListPlanId.leadId.jobId,
          }
        : null,
    },
  })
})

exports.verifyLoad = asyncHandler(async (req, res) => {
  const { actualWeight } = req.body

  const pl = await PackingList.findById(req.params.loadId)
  if (!pl) return notFound(res, 'Load not found')

  if (actualWeight !== undefined) pl.actualWeight = actualWeight
  pl.weightVerified = true
  pl.loadingVerified = true
  pl.verifiedAt = new Date()
  pl.verifiedBy = req.user._id
  await pl.save()

  return success(
    res,
    { loadId: pl._id, weightVerified: pl.weightVerified, loadingVerified: pl.loadingVerified },
    'Load verified'
  )
})

exports.confirmDispatch = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.loadId)
  if (!pl) return notFound(res, 'Load not found')
  if (!pl.weightVerified || !pl.loadingVerified) {
    return badRequest(res, 'Load must be verified before dispatch')
  }

  pl.status = 'dispatched'
  pl.dispatchedAt = new Date()
  await pl.save()

  return success(res, { loadId: pl._id, status: pl.status }, 'Dispatch confirmed')
})

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

  const mapped = {
    packingListNo: pl.packingListNo,
    truck: pl.truckLabel || pl.truckType,
    destination: pl.deliveryLocation || pl.packingListPlanId?.leadId?.location || '',
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

exports.exportPackingListsExcel = asyncHandler(async (req, res) => {
  const filter = await buildPackingListFilter(req.query)
  const sort = parseSortBy(req.query.sortBy, packingListSortMap)

  const lists = await PackingList.find(filter)
    .select('packingListNo truckType truckLabel totalBundles totalWeight status deliveryLocation packingListPlanId')
    .populate(packingListPopulate)
    .sort(sort)
    .lean()

  const rows = lists.map(mapPackingListRow)

  const buffer = await generatePackingListExcel(rows)

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="packing-lists.xlsx"')
  return res.send(buffer)
})

exports.markPackingListReady = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.packingListId)
  if (!pl) return notFound(res, 'Packing list not found')

  pl.status = 'ready'
  await pl.save()

  return success(res, { packingListId: pl._id, status: pl.status }, 'Packing list marked ready')
})

exports.markPackingListLoading = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.packingListId)
  if (!pl) return notFound(res, 'Packing list not found')

  pl.status = 'loading'
  await pl.save()

  return success(res, { packingListId: pl._id, status: pl.status }, 'Packing list marked loading')
})

exports.markPackingListDispatch = asyncHandler(async (req, res) => {
  const pl = await PackingList.findById(req.params.packingListId)
  if (!pl) return notFound(res, 'Packing list not found')

  pl.status = 'dispatched'
  pl.dispatchedAt = new Date()
  await pl.save()

  return success(res, { packingListId: pl._id, status: pl.status }, 'Packing list marked dispatched')
})
