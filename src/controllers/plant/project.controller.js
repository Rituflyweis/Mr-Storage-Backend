const POOrder = require('../../models/POOrder')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
const Building = require('../../models/Building')
const Invoice = require('../../models/Invoice')
const Delivery = require('../../models/Delivery')
const ShipperRequest = require('../../models/ShipperRequest')
const AuditLog = require('../../models/AuditLog')
const auditService = require('../../services/audit.service')
const { formatLeadNotes, appendLeadNote } = require('../../services/leadNotes.service')
const { formatLog } = require('../../services/auditActivity.service')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { validatePlantLifecycleTransition } = require('../../utils/plantLifecycle')
const { buildDateFilter } = require('../../utils/dateRange')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

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

const getNextVersionNumber = (drawings = []) =>
  drawings.reduce((max, drawing) => Math.max(max, drawing.versionNumber || 0), 0) + 1

const formatLatestDrawingSummary = (drawing) => {
  if (!drawing) return null
  return {
    versionNumber: drawing.versionNumber,
    fileName: drawing.fileName,
    fileUrl: drawing.fileUrl,
    status: drawing.status,
    uploadedAt: drawing.uploadedAt,
    reviewedAt: drawing.reviewedAt || null,
    rejectionReason: drawing.rejectionReason || '',
  }
}

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

const populateLifecycleHistory = async (history = []) => {
  const ids = [...new Set(history.map((h) => h.changedBy).filter(Boolean).map(String))]
  const users = ids.length
    ? await User.find({ _id: { $in: ids } }).select('_id name email role').lean()
    : []
  const userMap = new Map(users.map((u) => [String(u._id), u]))

  return history.map((h) => ({
    stage: h.stage,
    changedAt: h.changedAt,
    changedBy: h.changedBy
      ? userMap.get(String(h.changedBy)) || { _id: h.changedBy }
      : null,
  }))
}

const formatClientAddress = (customer, lead) => {
  const parts = [
    customer?.location,
    lead?.location,
    customer?.company,
  ].filter((p) => p && String(p).trim())
  return parts.join(', ').trim()
}

const formatAgreement = (lead) => {
  const contract = lead.documents?.find((d) => d.type === 'contract')
  if (!contract) return null
  return {
    url: contract.url || '',
    fileName: contract.name || '',
    uploadedAt: contract.uploadedAt || null,
  }
}

const guardProject = async (req, res) => {
  const { leadId } = req.params
  const result = await assertPlantProjectAccess(leadId, req.user._id)
  if (result.error) {
    if (result.code === 404) {
      notFound(res, result.error)
      return null
    }
    forbidden(res, result.error)
    return null
  }
  return result
}

exports.getProjectDetail = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead, poOrder } = access
  const leadId = lead._id

  const [assignedSales, buildings, leadNotes, activityLogs] = await Promise.all([
    User.findById(lead.assignedSales).select('_id name email role').lean(),
    Building.find({ leadId }).select('buildingNumber status drawings').sort({ buildingNumber: 1 }).lean(),
    formatLeadNotes(lead),
    AuditLog.find({ leadId })
      .populate('performedBy', 'name email role')
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'customerId', select: 'firstName' })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
  ])

  await lead.populate('customerId')
  const customerDoc = lead.customerId
  const leadLean = lead.toObject()
  const lifecycleHistory = await populateLifecycleHistory(leadLean.lifecycleHistory || [])

  const activityLog = activityLogs.map((log) => ({
    _id: log._id,
    type: log.type,
    action: log.action,
    displayMessage: formatLog(log),
    performedBy: log.performedBy
      ? { _id: log.performedBy._id, name: log.performedBy.name, email: log.performedBy.email, role: log.performedBy.role }
      : null,
    metadata: log.metadata || {},
    createdAt: log.createdAt,
  }))

  return success(res, {
    lead: leadLean,
    projectName: leadLean.projectName || '',
    jobId: leadLean.jobId || '',
    buildingType: leadLean.buildingType || '',
    quoteValue: leadLean.quoteValue ?? 0,
    location: leadLean.location || '',
    createdAt: leadLean.createdAt,
    lifecycleStatus: leadLean.lifecycleStatus,
    lifecycleHistory,
    numberOfBuildings: leadLean.numberOfBuildings ?? buildings.length,
    endDate: leadLean.endDate || null,
    isTerminated: leadLean.isTerminated === true,
    client: customerDoc
      ? {
          customerId: customerDoc.customerId || '',
          firstName: customerDoc.firstName || '',
          lastName: customerDoc.lastName || '',
          email: customerDoc.email || '',
          phone: customerDoc.phone || { number: '', countryCode: '' },
          address: formatClientAddress(customerDoc, leadLean),
        }
      : null,
    assignedSales: assignedSales
      ? { _id: assignedSales._id, name: assignedSales.name, email: assignedSales.email, role: assignedSales.role }
      : null,
    agreement: formatAgreement(leadLean),
    poOrder: {
      _id: poOrder._id,
      poNumber: poOrder.poNumber,
      status: poOrder.status,
      createdAt: poOrder.createdAt,
    },
    leadNotes,
    activityLog,
  })
})

exports.updateProjectLifecycle = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access
  const { lifecycleStatus, note } = req.body

  if (!lifecycleStatus) return badRequest(res, 'lifecycleStatus is required')

  const transitionError = validatePlantLifecycleTransition(lead.lifecycleStatus, lifecycleStatus)
  if (transitionError) return badRequest(res, transitionError.error)

  lead.lifecycleStatus = lifecycleStatus
  lead.lifecycleHistory.push({
    stage: lifecycleStatus,
    changedAt: new Date(),
    changedBy: req.user._id,
  })
  await lead.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.LEAD_LIFECYCLE_UPDATED,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { lifecycleStatus, projectName: lead.projectName || '' },
  })

  if (note && String(note).trim()) {
    await appendLeadNote(lead, note, req.user._id)
  }

  const lifecycleHistory = await populateLifecycleHistory(lead.lifecycleHistory)

  return success(res, {
    leadId: lead._id,
    lifecycleStatus: lead.lifecycleStatus,
    lifecycleHistory,
  })
})

exports.getProjectNotes = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access

  const notes = await formatLeadNotes(lead)

  return success(res, {
    leadId: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    notes,
    total: notes.length,
  })
})

exports.createProjectNote = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access
  const { note } = req.body

  try {
    const entry = await appendLeadNote(lead, note, req.user._id)
    return success(res, { note: entry }, 'Note added')
  } catch (err) {
    if (err.code === 'NOTE_REQUIRED') return badRequest(res, err.message)
    throw err
  }
})

exports.getProjectInvoices = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  const invoices = await Invoice.find({ leadId })
    .select('invoiceNumber dueDate totalAmount status createdAt')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, {
    invoices: invoices.map((inv) => ({
      _id: inv._id,
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate,
      amount: inv.totalAmount ?? 0,
      status: inv.status,
    })),
  })
})

exports.getProjectBuildings = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access
  const leadId = lead._id

  const buildings = await Building.find({ leadId })
    .select('buildingNumber status drawings')
    .sort({ buildingNumber: 1 })
    .lean()

  return success(res, {
    leadId,
    projectName: lead.projectName || '',
    numberOfBuildings: lead.numberOfBuildings ?? buildings.length,
    buildings: buildings.map((b) => {
      const latest = getLatestDrawing(b.drawings)
      return {
        buildingId: b._id,
        buildingNumber: b.buildingNumber,
        status: b.status,
        latestDrawing: formatLatestDrawingSummary(latest),
        latestDrawingStatus: latest?.status || null,
        drawingCount: (b.drawings || []).length,
        hasDrawing: (b.drawings || []).length > 0,
      }
    }),
  })
})

exports.uploadProjectDrawings = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access
  const leadId = lead._id
  const { drawings: drawingEntries } = req.body

  const buildingIds = drawingEntries.map((d) => String(d.buildingId))
  const uniqueIds = new Set(buildingIds)
  if (uniqueIds.size !== buildingIds.length) {
    return badRequest(res, 'Duplicate buildingId in drawings array')
  }

  const buildings = await Building.find({
    leadId,
    _id: { $in: [...uniqueIds] },
  })

  if (buildings.length !== uniqueIds.size) {
    const found = new Set(buildings.map((b) => String(b._id)))
    const missing = [...uniqueIds].filter((id) => !found.has(id))
    return badRequest(res, `Building(s) not found for this project: ${missing.join(', ')}`)
  }

  const buildingMap = new Map(buildings.map((b) => [String(b._id), b]))
  const uploaded = []
  const now = new Date()

  for (const entry of drawingEntries) {
    const building = buildingMap.get(String(entry.buildingId))
    const versionNumber = getNextVersionNumber(building.drawings)

    const newDrawing = {
      versionNumber,
      fileUrl: entry.fileUrl.trim(),
      fileName: entry.fileName.trim(),
      status: 'pending_review',
      uploadedBy: req.user._id,
      uploadedAt: now,
      reviewedAt: null,
      rejectionReason: '',
    }

    building.drawings.push(newDrawing)
    building.status = 'drawing_uploaded'

    uploaded.push({
      buildingId: building._id,
      buildingNumber: building.buildingNumber,
      drawing: {
        versionNumber: newDrawing.versionNumber,
        fileUrl: newDrawing.fileUrl,
        fileName: newDrawing.fileName,
        status: newDrawing.status,
        uploadedAt: newDrawing.uploadedAt,
        uploadedBy: req.user._id,
      },
      buildingStatus: building.status,
    })
  }

  await Promise.all([...buildingMap.values()].map((b) => b.save()))

  for (const item of uploaded) {
    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.DRAWING_UPLOADED,
      leadId,
      customerId: lead.customerId,
      performedBy: req.user._id,
      metadata: {
        buildingId: item.buildingId,
        buildingNumber: item.buildingNumber,
        versionNumber: item.drawing.versionNumber,
        fileName: item.drawing.fileName,
      },
    })
  }

  const allBuildings = await Building.find({ leadId }).select('drawings').lean()
  const projectDrawingStatus = computeDrawingStatus(allBuildings)

  return created(res, {
    leadId,
    uploaded,
    projectDrawingStatus,
  }, 'Drawing(s) uploaded')
})

exports.getProjectDrawings = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  const buildings = await Building.find({ leadId })
    .select('buildingNumber drawings')
    .sort({ buildingNumber: 1 })
    .lean()

  return success(res, {
    buildings: buildings.map((b) => ({
      buildingId: b._id,
      buildingNumber: b.buildingNumber,
      drawings: b.drawings || [],
      latestDrawingStatus: getLatestDrawing(b.drawings)?.status || null,
    })),
  })
})

exports.getProjectBomFiles = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  let bomFiles = []
  try {
    const BOMJob = require('../../models/BOMJob')
    const jobs = await BOMJob.find({ leadId })
      .select('buildingId buildingNumber fileName fileUrl status uploadedAt totalItems isConfirmed createdAt')
      .sort({ createdAt: -1 })
      .lean()
    bomFiles = jobs.map((j) => ({
      buildingId: j.buildingId,
      buildingNumber: j.buildingNumber,
      bomJobId: j._id,
      fileName: j.fileName || '',
      fileUrl: j.fileUrl || '',
      status: j.status,
      uploadedAt: j.uploadedAt || j.createdAt,
      totalItems: j.totalItems ?? 0,
      isConfirmed: j.isConfirmed === true,
    }))
  } catch {
    bomFiles = []
  }

  return success(res, { bomFiles })
})

exports.getProjectDelivery = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  const deliveries = await Delivery.find({ leadId })
    .sort({ createdAt: -1 })
    .lean()

  return success(res, {
    deliveries: deliveries.map((d) => ({
      _id: d._id,
      deliveryNumber: d.deliveryNumber,
      status: d.status,
      pickupLocation: d.pickupLocation || '',
      deliveryLocation: d.deliveryLocation || '',
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  })
})

exports.getProjectShipperFiles = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  const requests = await ShipperRequest.find({ leadId })
    .populate('vendorId', 'vendorName vendorCode email')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, {
    shipperFiles: requests.map((r) => ({
      _id: r._id,
      vendorId: r.vendorId?._id || r.vendorId,
      vendorName: r.vendorId?.vendorName || '',
      status: r.status,
      submittedFileUrl: r.submittedFileUrl || null,
      submittedFileName: r.submittedFileName || '',
      submittedAt: r.submittedAt,
      quoteValue: r.quoteValue,
      sentAt: r.sentAt,
    })),
  })
})
