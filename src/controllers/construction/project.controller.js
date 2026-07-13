const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const PROJECT_SELECT = 'projectName jobId buildingType location lifecycleStatus endDate plannedStartDate customerId'
const PROJECT_POPULATE = { path: 'customerId', select: 'firstName lastName email' }

exports.getProjects = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const filter = {
    isTerminated: { $ne: true },
  }
  if (status) filter.lifecycleStatus = status

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

  const [deliveries, tasks] = await Promise.all([
    Delivery.find({ leadId: lead._id, status: { $ne: 'draft' } })
      .select('deliveryNumber status deliveryDate description')
      .sort({ deliveryDate: -1 })
      .limit(5)
      .lean(),
    Task.find({ leadId: lead._id }).select('title status priority dueDate assignedTo').lean(),
  ])

  return success(res, { project: lead, deliveries, tasks })
})
