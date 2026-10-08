const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { businessUnitFields } = require('../../utils/businessUnit')
const { listUpcomingMaterialDeliveries } = require('../../utils/constructionProjectMaterialDeliveries')
const {
  buildConstructionDeliveryCalendar,
  resolveConstructionCalendarLeadIds,
} = require('../../utils/constructionProjectCalendar')
const {
  CONSTRUCTION_STAGES,
  buildConstructionProjectsFilter,
  listOnlyFilterKeys,
} = require('../../utils/constructionProjectScope')
const { loadProjectStatsForMongoFilter } = require('../../utils/constructionProjectStats')
const Building = require('../../models/Building')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const BundlePlan = require('../../models/BundlePlan')

const PROJECT_SELECT = 'projectName jobId businessUnit buildingType location lifecycleStatus priority endDate plannedStartDate customerId createdAt'

const withBusinessUnit = (lead) => ({ ...lead, ...businessUnitFields(lead) })
const PROJECT_POPULATE = { path: 'customerId', select: 'firstName lastName email' }

const isConstructionProject = (lead) =>
  lead && CONSTRUCTION_STAGES.includes(lead.lifecycleStatus)

const startOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

const endOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

exports.getProjects = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  if (status && !CONSTRUCTION_STAGES.includes(status)) {
    return badRequest(res, `status must be a construction stage: ${CONSTRUCTION_STAGES.join(', ')}`)
  }

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)

  const [listFilter, scopeFilter] = await Promise.all([
    buildConstructionProjectsFilter(req.query, { scopeOnly: false }),
    buildConstructionProjectsFilter(req.query, { scopeOnly: true }),
  ])

  const skip = (Number(page) - 1) * Number(limit)
  const [leads, total, scopeStatsResult] = await Promise.all([
    Lead.find(listFilter)
      .select(PROJECT_SELECT)
      .populate(PROJECT_POPULATE)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Lead.countDocuments(listFilter),
    loadProjectStatsForMongoFilter(scopeFilter, { todayStart, todayEnd, now }),
  ])

  const listOnlyFilters = listOnlyFilterKeys(req.query)

  return success(res, {
    projects: leads.map(withBusinessUnit),
    /** Paginated row count after all list query filters (`search`, `hasDelivery`, `priority`, etc.). */
    total,
    page: Number(page),
    limit: Number(limit),
    scope: 'construction',
    stages: CONSTRUCTION_STAGES,
    /** Same KPI object as `GET /api/construction/dashboard` → `projectStats` (scope = status + businessUnit only). */
    projectStats: scopeStatsResult.projectStats,
    listFiltersApplied: {
      status: req.query.status || null,
      businessUnit: req.query.businessUnit || null,
      priority: req.query.priority || null,
      search: req.query.search?.trim() || null,
      hasDelivery:
        String(req.query.hasDelivery).toLowerCase() === 'true' || req.query.hasDelivery === '1' || false,
    },
    /** When `total` differs from `projectStats.total`, these list-only filters are usually the cause. */
    listOnlyFilters,
  })
})

exports.getProjectCalendar = asyncHandler(async (req, res) => {
  const now = new Date()
  const m = Number(req.query.month) || now.getMonth() + 1
  const y = Number(req.query.year) || now.getFullYear()

  const leadIds = await resolveConstructionCalendarLeadIds({
    stages: CONSTRUCTION_STAGES,
    businessUnit: req.query.businessUnit,
  })

  const payload = await buildConstructionDeliveryCalendar({
    leadIds,
    month: m,
    year: y,
    filterLeadId: req.query.leadId,
    businessUnit: req.query.businessUnit,
  })

  return success(res, payload)
})

exports.getProjectDetail = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId)
    .select(PROJECT_SELECT + ' endDate plannedStartDate numberOfBuildings description')
    .populate(PROJECT_POPULATE)
    .lean()
  if (!lead) return notFound(res, 'Project not found')
  if (!isConstructionProject(lead)) {
    return notFound(res, 'Project is not in construction scope (still in sales pipeline)')
  }

  const [upcomingMaterialDeliveries, siteDeliveries, tasks, buildingCount, hasConsolidatedBom, hasBundlePlan] =
    await Promise.all([
      listUpcomingMaterialDeliveries(lead._id, { limit: 10 }),
      Delivery.find({
        leadId: lead._id,
        status: { $nin: ['draft', 'cancelled', 'delivered'] },
        deliveryDate: { $gte: new Date() },
      })
        .select('deliveryNumber status deliveryDate description materialType loadWeight')
        .sort({ deliveryDate: 1 })
        .limit(5)
        .lean(),
      Task.find({ leadId: lead._id }).select('title status priority dueDate assignedTo').lean(),
      Building.countDocuments({ leadId: lead._id }),
      ConsolidatedBOM.exists({ leadId: lead._id, fileUrl: { $ne: null } }),
      BundlePlan.exists({ leadId: lead._id, status: { $ne: 'cancelled' } }),
    ])

  const project = {
    ...withBusinessUnit(lead),
    numberOfBuildings: lead.numberOfBuildings ?? buildingCount,
  }

  return success(res, {
    project,
    /** Plant freight — powers "Upcoming Material Delivery" on project detail */
    upcomingMaterialDeliveries,
    /** @deprecated use upcomingMaterialDeliveries; kept for older clients */
    deliveries: upcomingMaterialDeliveries,
    siteDeliveries,
    tasks,
    manufacturing: {
      bomFilesPath: `/api/construction/projects/${lead._id}/bom-files`,
      consolidatedBomPath: `/api/construction/projects/${lead._id}/consolidated-bom`,
      buildingDrawingsPath: `/api/construction/projects/${lead._id}/building-drawings`,
      photosVideosPath: `/api/construction/projects/${lead._id}/photos-videos`,
      materialDeliveryDetailPath: `/api/construction/projects/${lead._id}/material-delivery`,
      materialDeliveriesPath: `/api/construction/projects/${lead._id}/material-deliveries`,
      bundlePlanPath: `/api/construction/projects/${lead._id}/bundle-plan`,
      truckPlanPath: `/api/construction/projects/${lead._id}/truck-plan`,
      structuralDrawingPath: `/api/construction/projects/${lead._id}/structural-drawing`,
      hasConsolidatedBom: Boolean(hasConsolidatedBom),
      hasBundlePlan: Boolean(hasBundlePlan),
    },
  })
})
