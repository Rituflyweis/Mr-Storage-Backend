const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { PLANT_LIFECYCLE_STAGES } = require('../../config/constants')
const { businessUnitFields, applyBusinessUnitFilter } = require('../../utils/businessUnit')
const { listUpcomingMaterialDeliveries } = require('../../utils/constructionProjectMaterialDeliveries')
const Building = require('../../models/Building')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const BundlePlan = require('../../models/BundlePlan')

/** Construction panel only lists projects handed into plant/construction (not sales pipeline). */
const CONSTRUCTION_STAGES = [...PLANT_LIFECYCLE_STAGES]

const PROJECT_SELECT = 'projectName jobId businessUnit buildingType location lifecycleStatus priority endDate plannedStartDate customerId createdAt'

const withBusinessUnit = (lead) => ({ ...lead, ...businessUnitFields(lead) })
const PROJECT_POPULATE = { path: 'customerId', select: 'firstName lastName email' }

const isConstructionProject = (lead) =>
  lead && CONSTRUCTION_STAGES.includes(lead.lifecycleStatus)

exports.getProjects = asyncHandler(async (req, res) => {
  const { status, priority, search, page = 1, limit = 20, hasDelivery } = req.query

  const filter = {
    isTerminated: { $ne: true },
    lifecycleStatus: { $in: CONSTRUCTION_STAGES },
  }

  // Optional status must still be a construction/plant stage
  if (status) {
    if (!CONSTRUCTION_STAGES.includes(status)) {
      return badRequest(res, `status must be a construction stage: ${CONSTRUCTION_STAGES.join(', ')}`)
    }
    filter.lifecycleStatus = status
  }
  if (priority) filter.priority = priority
  applyBusinessUnitFilter(filter, req.query.businessUnit)
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [{ projectName: regex }, { jobId: regex }]
  }

  // Optional: only projects that already have at least one non-draft delivery
  if (String(hasDelivery).toLowerCase() === 'true' || hasDelivery === '1') {
    const leadIdsWithDelivery = await Delivery.distinct('leadId', {
      status: { $nin: ['draft', 'cancelled'] },
    })
    filter._id = { $in: leadIdsWithDelivery }
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .select(PROJECT_SELECT)
      .populate(PROJECT_POPULATE)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, {
    projects: leads.map(withBusinessUnit),
    total,
    page: Number(page),
    limit: Number(limit),
    scope: 'construction',
    stages: CONSTRUCTION_STAGES,
  })
})

exports.getProjectCalendar = asyncHandler(async (req, res) => {
  const { month, year, leadId } = req.query
  const now = new Date()
  const m = Number(month) || now.getMonth() + 1
  const y = Number(year) || now.getFullYear()

  const startOfMonth = new Date(y, m - 1, 1)
  const endOfMonth = new Date(y, m, 0, 23, 59, 59)

  const constructionLeadIds = await Lead.find(
    applyBusinessUnitFilter(
      { isTerminated: { $ne: true }, lifecycleStatus: { $in: CONSTRUCTION_STAGES } },
      req.query.businessUnit
    )
  )
    .select('_id')
    .lean()
    .then((rows) => rows.map((r) => r._id))

  if (!constructionLeadIds.length) {
    return success(res, { month: m, year: y, calendar: {}, totalDeliveries: 0 })
  }

  const deliveryFilter = {
    leadId: { $in: constructionLeadIds },
    deliveryDate: { $gte: startOfMonth, $lte: endOfMonth },
    status: { $ne: 'draft' },
  }
  if (leadId) {
    if (!constructionLeadIds.some((id) => String(id) === String(leadId))) {
      return success(res, { month: m, year: y, calendar: {}, totalDeliveries: 0 })
    }
    deliveryFilter.leadId = leadId
  }

  const deliveries = await Delivery.find(deliveryFilter)
    .select('deliveryDate deliveryNumber status description leadId')
    .populate('leadId', 'projectName jobId businessUnit location lifecycleStatus')
    .lean()

  const calendarMap = {}
  for (const d of deliveries) {
    if (!d.deliveryDate) continue
    const dateKey = new Date(d.deliveryDate).toISOString().split('T')[0]
    if (!calendarMap[dateKey]) calendarMap[dateKey] = []
    calendarMap[dateKey].push({
      deliveryId: d._id,
      deliveryNumber: d.deliveryNumber,
      status: d.status,
      description: d.description,
      project: {
        leadId: d.leadId?._id,
        projectName: d.leadId?.projectName,
        jobId: d.leadId?.jobId,
        ...businessUnitFields(d.leadId),
        location: d.leadId?.location,
        lifecycleStatus: d.leadId?.lifecycleStatus,
      },
    })
  }

  return success(res, {
    month: m,
    year: y,
    calendar: calendarMap,
    totalDeliveries: deliveries.length,
  })
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
      materialDeliveriesPath: `/api/construction/projects/${lead._id}/material-deliveries`,
      bundlePlanPath: `/api/construction/projects/${lead._id}/bundle-plan`,
      truckPlanPath: `/api/construction/projects/${lead._id}/truck-plan`,
      hasConsolidatedBom: Boolean(hasConsolidatedBom),
      hasBundlePlan: Boolean(hasBundlePlan),
    },
  })
})
