const Bundle = require('../../models/Bundle')
const PackingList = require('../../models/PackingList')
const Lead = require('../../models/Lead')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

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
    labelsPrinted: await Bundle.countDocuments({ status: { $in: ['assigned_to_truck', 'dispatched'] } }),
    labelsPending: await Bundle.countDocuments({ status: { $in: ['pending', 'ready'] } }),
    labelsPrintedToday: await Bundle.countDocuments({
      status: { $in: ['assigned_to_truck', 'dispatched'] },
      updatedAt: { $gte: new Date(now.toDateString()) },
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
