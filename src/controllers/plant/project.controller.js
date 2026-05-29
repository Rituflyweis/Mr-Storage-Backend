const POOrder = require('../../models/POOrder')
const Lead = require('../../models/Lead')
const Building = require('../../models/Building')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const BOM_CONFIRMED_STATUSES = ['bom_confirmed', 'completed']
const BOM_STARTED_STATUSES = ['bom_pending', 'bom_approved', 'bom_confirmed', 'completed']

const getAssignedLeadIds = async (plantUserId, query) => {
  const poFilter = {
    assignedTo: plantUserId,
    status: 'approved',
    ...buildDateFilter(query, 'createdAt'),
  }
  return POOrder.distinct('leadId', poFilter)
}

const getLatestDrawing = (drawings = []) =>
  drawings.reduce((latest, drawing) =>
    (!latest || drawing.versionNumber > latest.versionNumber ? drawing : latest), null)

const computeDrawingStatus = (buildings = []) => {
  if (!buildings.length) return 'none'

  let hasAnyDrawing = false
  let hasPending = false
  let hasRejected = false
  let allApproved = true

  for (const building of buildings) {
    const latest = getLatestDrawing(building.drawings)
    if (!latest) {
      allApproved = false
      continue
    }

    hasAnyDrawing = true
    if (latest.status === 'pending_review') hasPending = true
    if (latest.status === 'rejected') hasRejected = true
    if (latest.status !== 'approved') allApproved = false
  }

  if (!hasAnyDrawing) return 'none'
  if (hasPending) return 'pending'
  if (hasRejected) return 'rejected'
  if (allApproved) return 'all_approved'
  return 'pending'
}

const computeBomStatus = (buildings = []) => {
  if (!buildings.length) return 'none'

  const confirmedCount = buildings.filter(b => BOM_CONFIRMED_STATUSES.includes(b.status)).length
  if (confirmedCount === buildings.length) return 'all_confirmed'

  const hasBomActivity = buildings.some(b => BOM_STARTED_STATUSES.includes(b.status))
  if (hasBomActivity || confirmedCount > 0) return 'partial'

  return 'none'
}

const formatClientName = (customer) => {
  if (!customer) return ''
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()
}

const buildPlantProjectFilter = (leadIds, query) => {
  const { projectId, customerId, buildingType } = query
  let scopedLeadIds = leadIds

  if (projectId) {
    scopedLeadIds = leadIds.filter(id => String(id) === String(projectId))
  }

  const filter = { _id: { $in: scopedLeadIds } }

  if (customerId) filter.customerId = customerId
  if (buildingType) filter.buildingType = buildingType.trim()

  return filter
}

const mapProjectRow = (lead, buildings = []) => {
  const customer = lead.customerId
  const clientName = formatClientName(customer)

  return {
    _id: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    location: lead.location || '',
    clientName,
    customer: customer
      ? { firstName: customer.firstName || '', lastName: customer.lastName || '' }
      : { firstName: '', lastName: '' },
    buildingType: lead.buildingType || '',
    numberOfBuildings: lead.numberOfBuildings ?? buildings.length,
    quoteValue: lead.quoteValue ?? 0,
    drawingStatus: computeDrawingStatus(buildings),
    bomStatus: computeBomStatus(buildings),
    lifecycleStatus: lead.lifecycleStatus,
    isTerminated: lead.isTerminated,
    createdAt: lead.createdAt,
  }
}

exports.getProjectStats = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req.user._id, req.query)

  if (!leadIds.length) {
    return success(res, {
      totalProjects: 0,
      activeProjects: 0,
      pendingCustomerApproval: 0,
      cancelledProjects: 0,
    })
  }

  const leadFilter = { _id: { $in: leadIds } }

  const [totalProjects, cancelledProjects, activeProjects, pendingApprovalLeadIds] = await Promise.all([
    Lead.countDocuments(leadFilter),
    Lead.countDocuments({ ...leadFilter, isTerminated: true }),
    Lead.countDocuments({ ...leadFilter, isTerminated: false }),
    Building.distinct('leadId', {
      leadId: { $in: leadIds },
      drawings: { $elemMatch: { status: 'pending_review' } },
    }),
  ])

  return success(res, {
    totalProjects,
    activeProjects,
    pendingCustomerApproval: pendingApprovalLeadIds.length,
    cancelledProjects,
  })
})

exports.getProjects = asyncHandler(async (req, res) => {
  const { drawingStatus, page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const leadIds = await getAssignedLeadIds(req.user._id, req.query)
  if (!leadIds.length) {
    return success(res, { projects: [], total: 0, page: parsedPage, limit: parsedLimit })
  }

  const filter = buildPlantProjectFilter(leadIds, req.query)

  const leads = await Lead.find(filter)
    .populate('customerId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean()

  if (!leads.length) {
    return success(res, { projects: [], total: 0, page: parsedPage, limit: parsedLimit })
  }

  const matchedLeadIds = leads.map(l => l._id)
  const buildings = await Building.find({ leadId: { $in: matchedLeadIds } })
    .select('leadId status drawings')
    .lean()

  const buildingsByLeadId = buildings.reduce((acc, building) => {
    const key = String(building.leadId)
    if (!acc[key]) acc[key] = []
    acc[key].push(building)
    return acc
  }, {})

  let projects = leads.map(lead =>
    mapProjectRow(lead, buildingsByLeadId[String(lead._id)] || [])
  )

  if (drawingStatus) {
    projects = projects.filter(p => p.drawingStatus === drawingStatus)
  }

  const total = projects.length
  const skip = (parsedPage - 1) * parsedLimit
  projects = projects.slice(skip, skip + parsedLimit)

  return success(res, { projects, total, page: parsedPage, limit: parsedLimit })
})
