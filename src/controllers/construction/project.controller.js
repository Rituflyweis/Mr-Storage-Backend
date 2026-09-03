const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const Building = require('../../models/Building')
const { getLatestBomJobsByBuilding } = require('../../utils/plantBomAccess')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const PROJECT_SELECT = 'projectName jobId buildingType location lifecycleStatus priority endDate plannedStartDate customerId createdAt'
const PROJECT_POPULATE = { path: 'customerId', select: 'firstName lastName email' }

exports.getProjects = asyncHandler(async (req, res) => {
  const { status, priority, search, page = 1, limit = 20 } = req.query
  const filter = {
    isTerminated: { $ne: true },
  }
  if (status) filter.lifecycleStatus = status
  if (priority) filter.priority = priority
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [{ projectName: regex }, { jobId: regex }]
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

  return success(res, { projects: leads, total, page: Number(page), limit: Number(limit) })
})

exports.getProjectCalendar = asyncHandler(async (req, res) => {
  const { month, year, leadId } = req.query
  const now = new Date()
  const m = Number(month) || now.getMonth() + 1
  const y = Number(year) || now.getFullYear()

  const startOfMonth = new Date(y, m - 1, 1)
  const endOfMonth = new Date(y, m, 0, 23, 59, 59)

  const deliveryFilter = {
    deliveryDate: { $gte: startOfMonth, $lte: endOfMonth },
    status: { $ne: 'draft' },
  }
  if (leadId) deliveryFilter.leadId = leadId

  const deliveries = await Delivery.find(deliveryFilter)
    .select('deliveryDate deliveryNumber status description leadId')
    .populate('leadId', 'projectName jobId location')
    .lean()

  const calendarMap = {}
  for (const d of deliveries) {
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
        location: d.leadId?.location,
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

  const now = new Date()
  const [upcomingDeliveries, tasks] = await Promise.all([
    // "Upcoming Material Delivery" — future, not-yet-delivered deliveries, soonest first.
    Delivery.find({ leadId: lead._id, status: { $nin: ['draft', 'cancelled', 'delivered'] }, deliveryDate: { $gte: now } })
      .select('deliveryNumber status deliveryDate description materialType loadWeight')
      .sort({ deliveryDate: 1 })
      .limit(5)
      .lean(),
    Task.find({ leadId: lead._id }).select('title status priority dueDate assignedTo').lean(),
  ])

  return success(res, { project: lead, deliveries: upcomingDeliveries, tasks })
})

// GET /projects/:leadId/bom — "View BOM File" button on the Project & Calendar screen.
// Reuses the same per-building latest-BOM-job lookup the Plant Panel uses — the construction
// tablet app only needs to view/download the file, not the plant BOM review workflow.
exports.getProjectBom = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId).select('projectName jobId').lean()
  if (!lead) return notFound(res, 'Project not found')

  const [bomJobMap, buildings] = await Promise.all([
    getLatestBomJobsByBuilding(leadId),
    Building.find({ leadId }).select('buildingNumber').lean(),
  ])
  const buildingNumberById = new Map(buildings.map((b) => [String(b._id), b.buildingNumber]))

  const bomFiles = [...bomJobMap.values()].map((j) => ({
    buildingId: j.buildingId,
    buildingNumber: buildingNumberById.get(String(j.buildingId)) ?? null,
    bomJobId: j._id,
    fileName: j.fileName || '',
    fileUrl: j.fileUrl || '',
    fileFormat: j.fileFormat,
    status: j.status,
    uploadedAt: j.createdAt,
    totalItems: j.totalItems ?? 0,
    matchedItems: j.matchedItems ?? 0,
    unmatchedItems: j.unmatchedItems ?? 0,
  })).sort((a, b) => (a.buildingNumber ?? 0) - (b.buildingNumber ?? 0))

  return success(res, { project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId }, bomFiles })
})
