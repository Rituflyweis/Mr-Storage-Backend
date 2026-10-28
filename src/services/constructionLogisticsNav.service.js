const Lead = require('../models/Lead')
const PackingList = require('../models/PackingList')
const PackingListPlan = require('../models/PackingListPlan')
const Bundle = require('../models/Bundle')
const { getConstructionLeadIds } = require('../utils/constructionProjectScope')
const { PACKING_LIST_STATUSES } = require('../config/constants')

const projectSelect = 'projectName jobId location lifecycleStatus updatedAt'

const mapProjectRow = (lead, extras = {}) => ({
  leadId: lead._id,
  projectId: lead.jobId || '',
  jobId: lead.jobId || '',
  projectName: lead.projectName || '',
  location: lead.location || '',
  lifecycleStatus: lead.lifecycleStatus || '',
  ...extras,
})

/** Step 1 — projects in construction scope with logistics counts. */
exports.listLogisticsProjects = async (query = {}) => {
  const leadIds = await getConstructionLeadIds({
    businessUnit: query.businessUnit,
    status: query.status,
    projectId: query.projectId || query.leadId,
  })
  if (!leadIds.length) {
    return { projects: [], total: 0, page: 1, limit: 20 }
  }

  const { search, page = 1, limit = 20 } = query
  let leadFilter = { _id: { $in: leadIds } }
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    leadFilter = { ...leadFilter, $or: [{ projectName: regex }, { jobId: regex }, { location: regex }] }
  }

  const leads = await Lead.find(leadFilter).select(projectSelect).sort({ updatedAt: -1 }).lean()
  const scopedIds = leads.map((l) => l._id)

  const [loadCounts, bundleCounts, labelPendingCounts, planByLead] = await Promise.all([
    PackingList.aggregate([
      { $match: { leadId: { $in: scopedIds }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$leadId', count: { $sum: 1 }, lastAt: { $max: '$updatedAt' } } },
    ]),
    Bundle.aggregate([
      { $match: { leadId: { $in: scopedIds }, status: { $nin: ['cancelled'] } } },
      { $group: { _id: '$leadId', count: { $sum: 1 } } },
    ]),
    Bundle.aggregate([
      {
        $match: {
          leadId: { $in: scopedIds },
          status: { $nin: ['cancelled'] },
          $or: [{ labelPrinted: { $ne: true } }, { labelPrinted: null }],
        },
      },
      { $group: { _id: '$leadId', count: { $sum: 1 } } },
    ]),
    PackingListPlan.find({ leadId: { $in: scopedIds }, status: { $ne: 'cancelled' } })
      .select('leadId status totalPackingLists updatedAt')
      .sort({ updatedAt: -1 })
      .lean(),
  ])

  const loadMap = Object.fromEntries(loadCounts.map((r) => [String(r._id), r]))
  const bundleMap = Object.fromEntries(bundleCounts.map((r) => [String(r._id), r.count]))
  const labelMap = Object.fromEntries(labelPendingCounts.map((r) => [String(r._id), r.count]))
  const latestPlan = new Map()
  for (const plan of planByLead) {
    const key = String(plan.leadId)
    if (!latestPlan.has(key)) latestPlan.set(key, plan)
  }

  let projects = leads.map((lead) => {
    const key = String(lead._id)
    const loads = loadMap[key]
    const plan = latestPlan.get(key)
    return mapProjectRow(lead, {
      totalLoads: loads?.count || 0,
      totalBundles: bundleMap[key] || 0,
      labelsPending: labelMap[key] || 0,
      lastLoadUpdate: loads?.lastAt || plan?.updatedAt || lead.updatedAt,
      packingListPlanId: plan?._id || null,
      packingListPlanStatus: plan?.status || null,
    })
  })

  projects.sort(
    (a, b) => new Date(b.lastLoadUpdate || 0).getTime() - new Date(a.lastLoadUpdate || 0).getTime()
  )

  const total = projects.length
  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 20))
  const paged = projects.slice((parsedPage - 1) * parsedLimit, (parsedPage - 1) * parsedLimit + parsedLimit)

  return { projects: paged, total, page: parsedPage, limit: parsedLimit }
}

const assertLeadInConstructionScope = async (leadId) => {
  const leadIds = await getConstructionLeadIds({ projectId: leadId })
  if (!leadIds.some((id) => String(id) === String(leadId))) return null
  return Lead.findById(leadId).select(projectSelect).lean()
}

const LOAD_SORT_FIELDS = {
  updatedAt: 'updatedAt',
  packingListNo: 'packingListNo',
  status: 'status',
  totalBundles: 'totalBundles',
  totalWeight: 'totalWeight',
}

/** Step 2 — loads (packing lists) for one project. */
exports.listLoadsForProject = async (leadId, query = {}) => {
  const lead = await assertLeadInConstructionScope(leadId)
  if (!lead) return { error: 'not_found' }

  const { page = 1, limit = 50, status, search, sortBy = 'updatedAt', sortOrder = 'desc' } = query
  const filter = { leadId, status: { $ne: 'cancelled' } }
  if (status && status !== 'all') filter.status = status
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [
      { packingListNo: regex },
      { truckLabel: regex },
      { truckType: regex },
    ]
  }

  const sortField = LOAD_SORT_FIELDS[sortBy] || 'updatedAt'
  const sortDir = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1

  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
  const skip = (parsedPage - 1) * parsedLimit

  const baseMatch = { leadId, status: { $ne: 'cancelled' } }

  const [loads, total, statusAgg, mismatchAgg] = await Promise.all([
    PackingList.find(filter)
      .select(
        'packingListNo truckType truckLabel totalBundles totalWeight maxLengthFeet status updatedAt bundleIds'
      )
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    PackingList.countDocuments(filter),
    PackingList.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Bundle.aggregate([
      {
        $match: {
          leadId: lead._id,
          status: { $nin: ['cancelled'] },
          $or: [
            { mismatchReportedAt: { $ne: null } },
            { 'mismatchItems.0': { $exists: true } },
            { mismatchNotes: { $nin: ['', null] } },
          ],
        },
      },
      { $group: { _id: '$packingListId', count: { $sum: 1 } } },
    ]),
  ])

  const statusMap = Object.fromEntries(statusAgg.map((r) => [r._id, r.count]))
  const mismatchByLoad = Object.fromEntries(mismatchAgg.map((r) => [String(r._id), r.count]))
  const totalLoads = statusAgg.reduce((s, r) => s + r.count, 0)

  const rows = loads.map((pl) => {
    const mismatchCount = mismatchByLoad[String(pl._id)] || 0
    return {
      packingListId: pl._id,
      packingListNo: pl.packingListNo,
      truckLabel: pl.truckLabel || pl.packingListNo,
      truckType: pl.truckType,
      status: pl.status,
      totalBundles: pl.totalBundles || (pl.bundleIds || []).length,
      totalWeight: pl.totalWeight,
      maxLengthFeet: pl.maxLengthFeet,
      mismatchCount,
      hasMismatch: mismatchCount > 0,
      updatedAt: pl.updatedAt,
    }
  })

  return {
    project: mapProjectRow(lead),
    loads: rows,
    total,
    page: parsedPage,
    limit: parsedLimit,
    stats: {
      totalLoads,
      byStatus: PACKING_LIST_STATUSES.filter((s) => s !== 'cancelled').map((s) => ({
        status: s,
        count: statusMap[s] || 0,
      })),
      draft: statusMap.draft || 0,
      confirmed: statusMap.confirmed || 0,
      ready: statusMap.ready || 0,
      loading: statusMap.loading || 0,
      deliveryCreated: statusMap.delivery_created || 0,
      dispatched: statusMap.dispatched || 0,
      delivered: statusMap.delivered || 0,
      withMismatch: mismatchAgg.length,
    },
    filters: {
      statuses: PACKING_LIST_STATUSES.filter((s) => s !== 'cancelled'),
      sortBy: Object.keys(LOAD_SORT_FIELDS),
    },
  }
}

/** Step 3 — bundles on one load (packing list). */
exports.listBundlesForLoad = async (packingListId, query = {}) => {
  const pl = await PackingList.findById(packingListId)
    .select('leadId packingListNo truckLabel status bundleIds totalBundles totalWeight')
    .lean()
  if (!pl) return { error: 'not_found' }

  const lead = await assertLeadInConstructionScope(pl.leadId)
  if (!lead) return { error: 'forbidden' }

  const filter = { packingListId: pl._id }
  if (query.labelPending === 'true' || query.labelPending === '1') {
    filter.$or = [{ labelPrinted: { $ne: true } }, { labelPrinted: null }]
  }
  if (query.status && query.status !== 'all') {
    filter.status = query.status
  }
  if (query.mismatch === 'true' || query.mismatch === '1') {
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { mismatchReportedAt: { $ne: null } },
          { 'mismatchItems.0': { $exists: true } },
          { mismatchNotes: { $nin: ['', null] } },
        ],
      },
    ]
  }

  const bundles = await Bundle.find(filter)
    .select(
      'bundleNo bundleType title totalWeight maxLengthFeet status labelPrinted labelPrintedAt verified packingListId updatedAt mismatchNotes mismatchReportedAt mismatchItems'
    )
    .sort({ bundleNo: 1 })
    .lean()

  const mapped = bundles.map((b) => {
    const mismatchItems = b.mismatchItems || []
    const hasMismatch =
      Boolean(b.mismatchReportedAt) ||
      mismatchItems.length > 0 ||
      Boolean(b.mismatchNotes && String(b.mismatchNotes).trim())
    return {
      bundleId: b._id,
      bundleNo: b.bundleNo,
      bundleType: b.bundleType,
      title: b.title,
      totalWeight: b.totalWeight,
      maxLengthFeet: b.maxLengthFeet,
      status: b.status,
      labelPrinted: Boolean(b.labelPrinted),
      labelPrintedAt: b.labelPrintedAt || null,
      verified: Boolean(b.verified),
      hasMismatch,
      mismatchNotes: b.mismatchNotes || '',
      mismatchReportedAt: b.mismatchReportedAt || null,
      mismatchItemCount: mismatchItems.length,
      updatedAt: b.updatedAt,
    }
  })

  return {
    project: mapProjectRow(lead),
    load: {
      packingListId: pl._id,
      packingListNo: pl.packingListNo,
      truckLabel: pl.truckLabel || pl.packingListNo,
      status: pl.status,
      totalBundles: pl.totalBundles || bundles.length,
      totalWeight: pl.totalWeight,
    },
    bundles: mapped,
    total: mapped.length,
    stats: {
      total: mapped.length,
      withMismatch: mapped.filter((b) => b.hasMismatch).length,
      verified: mapped.filter((b) => b.verified).length,
      labelPending: mapped.filter((b) => !b.labelPrinted).length,
    },
  }
}

exports.assertLeadInConstructionScope = assertLeadInConstructionScope
