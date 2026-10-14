const Lead = require('../models/Lead')
const PackingList = require('../models/PackingList')
const PackingListPlan = require('../models/PackingListPlan')
const Bundle = require('../models/Bundle')
const { getConstructionLeadIds } = require('../utils/constructionProjectScope')

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

/** Step 2 — loads (packing lists) for one project. */
exports.listLoadsForProject = async (leadId, query = {}) => {
  const lead = await assertLeadInConstructionScope(leadId)
  if (!lead) return { error: 'not_found' }

  const { page = 1, limit = 50, status } = query
  const filter = { leadId, status: { $ne: 'cancelled' } }
  if (status) filter.status = status

  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))

  const [loads, total] = await Promise.all([
    PackingList.find(filter)
      .select(
        'packingListNo truckType truckLabel totalBundles totalWeight maxLengthFeet status updatedAt bundleIds'
      )
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    PackingList.countDocuments(filter),
  ])

  const rows = loads.map((pl) => ({
    packingListId: pl._id,
    packingListNo: pl.packingListNo,
    truckLabel: pl.truckLabel || pl.packingListNo,
    truckType: pl.truckType,
    status: pl.status,
    totalBundles: pl.totalBundles || (pl.bundleIds || []).length,
    totalWeight: pl.totalWeight,
    maxLengthFeet: pl.maxLengthFeet,
    updatedAt: pl.updatedAt,
  }))

  return {
    project: mapProjectRow(lead),
    loads: rows,
    total,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: parsedLimit,
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

  const bundles = await Bundle.find(filter)
    .select(
      'bundleNo bundleType title totalWeight maxLengthFeet status labelPrinted labelPrintedAt verified packingListId updatedAt'
    )
    .sort({ bundleNo: 1 })
    .lean()

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
    bundles: bundles.map((b) => ({
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
      updatedAt: b.updatedAt,
    })),
    total: bundles.length,
  }
}

exports.assertLeadInConstructionScope = assertLeadInConstructionScope
