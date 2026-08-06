const Bundle = require('../../models/Bundle')
const PackingList = require('../../models/PackingList')
const Lead = require('../../models/Lead')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { generatePackingListDetailPdf } = require('../../utils/exportDelivery')
const { generatePackingListExcel } = require('../../utils/exportPackingLists')

exports.getBundleLabels = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query

  const filter = {}
  if (status) filter.status = status

  const skip = (Number(page) - 1) * Number(limit)
  const [bundles, total] = await Promise.all([
    Bundle.find(filter)
      .select('bundleNo bundleType title totalWeight maxLengthFeet status packingListId bundlePlanId items')
      .populate({
        path: 'bundlePlanId',
        select: 'leadId',
        populate: { path: 'leadId', select: 'projectName jobId location' },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Bundle.countDocuments(filter),
  ])

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const stats = {
    totalBundles: await Bundle.countDocuments({}),
    labelsPrinted: await Bundle.countDocuments({ labelPrinted: true }),
    labelsPending: await Bundle.countDocuments({ labelPrinted: false }),
    labelsPrintedToday: await Bundle.countDocuments({
      labelPrinted: true,
      labelPrintedAt: { $gte: new Date(now.toDateString()) },
    }),
  }

  const rows = bundles.map((b) => ({
    bundleId: b._id,
    bundleNo: b.bundleNo,
    bundleType: b.bundleType,
    title: b.title,
    parts: b.items?.map((i) => i.partNo || i.itemId).join(', ') || '',
    totalWeight: b.totalWeight,
    maxLengthFeet: b.maxLengthFeet,
    status: b.status,
    labelPrinted: b.labelPrinted || false,
    packingListId: b.packingListId,
    project: b.bundlePlanId?.leadId
      ? {
          leadId: b.bundlePlanId.leadId._id,
          projectName: b.bundlePlanId.leadId.projectName,
          jobId: b.bundlePlanId.leadId.jobId,
        }
      : null,
  }))

  return success(res, { bundles: rows, total, stats })
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
  const { page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const [bundles, total] = await Promise.all([
    Bundle.find({ status: { $in: ['assigned_to_truck', 'ready', 'staged', 'dispatched'] } })
      .select('bundleNo status totalWeight maxLengthFeet updatedAt packingListId bundlePlanId items')
      .populate({
        path: 'bundlePlanId',
        select: 'leadId',
        populate: { path: 'leadId', select: 'projectName jobId location' },
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Bundle.countDocuments({ status: { $in: ['assigned_to_truck', 'ready', 'staged', 'dispatched'] } }),
  ])

  const stats = {
    bundlesScanned: await Bundle.countDocuments({ status: { $in: ['assigned_to_truck', 'staged'] } }),
    bundlesRemaining: await Bundle.countDocuments({ status: { $in: ['pending', 'ready'] } }),
    bundlesLoaded: await Bundle.countDocuments({ status: 'dispatched' }),
  }

  const rows = bundles.map((b) => ({
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
  }))

  return success(res, { bundles: rows, total, stats })
})

exports.getPackingLists = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const [lists, total] = await Promise.all([
    PackingList.find({})
      .select('packingListNo truckType truckLabel totalBundles totalWeight maxLengthFeet status deliveryLocation packingListPlanId')
      .populate({
        path: 'packingListPlanId',
        select: 'leadId bundlePlanId',
        populate: { path: 'leadId', select: 'projectName jobId location' },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PackingList.countDocuments({}),
  ])

  const stats = {
    totalPackingList: await PackingList.countDocuments({}),
    loadsReadyForDispatch: await PackingList.countDocuments({ status: 'confirmed' }),
    bundlesAssigned: await Bundle.countDocuments({ packingListId: { $ne: null } }),
    loadsDispatchedToday: await PackingList.countDocuments({
      status: 'confirmed',
      updatedAt: { $gte: new Date(new Date().toDateString()) },
    }),
  }

  const rows = lists.map((pl) => ({
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
  }))

  return success(res, { packingLists: rows, total, stats })
})

exports.getDispatchVerification = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const [lists, total] = await Promise.all([
    PackingList.find({ status: { $in: ['confirmed', 'generated'] } })
      .select('packingListNo truckType truckLabel totalBundles totalWeight deliveryLocation status bundleIds packingListPlanId')
      .populate({
        path: 'packingListPlanId',
        select: 'leadId',
        populate: { path: 'leadId', select: 'projectName jobId location' },
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PackingList.countDocuments({ status: { $in: ['confirmed', 'generated'] } }),
  ])

  const stats = {
    loadsReadyForDispatch: await PackingList.countDocuments({ status: 'confirmed' }),
    bundlesVerified: await Bundle.countDocuments({ status: 'assigned_to_truck' }),
    bundlesMissing: await Bundle.countDocuments({ packingListId: null, status: { $ne: 'pending' } }),
    leadsDispatchedToday: await PackingList.countDocuments({
      status: 'confirmed',
      updatedAt: { $gte: new Date(new Date().toDateString()) },
    }),
  }

  const rows = lists.map((pl) => ({
    loadId: pl._id,
    packingListNo: pl.packingListNo,
    truck: pl.truckLabel || pl.truckType,
    totalBundles: pl.totalBundles,
    bundleIds: pl.bundleIds || [],
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
  }))

  return success(res, { loads: rows, total, stats })
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
  const { notes } = req.body
  if (!notes) return badRequest(res, 'notes is required')

  const bundle = await Bundle.findById(req.params.bundleId)
  if (!bundle) return notFound(res, 'Bundle not found')

  bundle.mismatchNotes = notes
  bundle.mismatchReportedAt = new Date()
  await bundle.save()

  return success(res, { bundleId: bundle._id, mismatchNotes: bundle.mismatchNotes }, 'Mismatch reported')
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
  const { status } = req.query
  const filter = {}
  if (status) filter.status = status

  const lists = await PackingList.find(filter)
    .select('packingListNo truckType truckLabel totalBundles totalWeight status deliveryLocation packingListPlanId')
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
    destination: pl.deliveryLocation || pl.packingListPlanId?.leadId?.location || '',
    status: pl.status,
    project: pl.packingListPlanId?.leadId ? { projectName: pl.packingListPlanId.leadId.projectName } : null,
  }))

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
