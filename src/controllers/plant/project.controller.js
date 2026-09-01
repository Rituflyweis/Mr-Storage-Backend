const crypto = require('crypto')
const POOrder = require('../../models/POOrder')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
const Building = require('../../models/Building')
const Invoice = require('../../models/Invoice')
const Vendor = require('../../models/Vendor')
const ShipperRequest = require('../../models/ShipperRequest')
const BOMJob = require('../../models/BOMJob')
const BOMItem = require('../../models/BOMItem')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const AuditLog = require('../../models/AuditLog')
const auditService = require('../../services/audit.service')
const { notifyCustomerDrawingUploaded } = require('../../services/customerNotification.service')
const { formatLeadNotes, appendLeadNote } = require('../../services/leadNotes.service')
const { enrichLeadDocument } = require('../../utils/leadProjectId')
const { formatLog } = require('../../services/auditActivity.service')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')
const { sortShipperRequestsByLowestBid } = require('../../utils/shipperRequestSort')
const { computeShipperFilesStats } = require('../../utils/shipperFilesStats')
const {
  buildAmountComparisonForRequest,
  loadConsolidatedBomCostMap,
} = require('../../utils/shipperAmountComparison')
const { validatePlantLifecycleTransition } = require('../../utils/plantLifecycle')
const { getLatestBomJobsByBuilding, formatBomJobSummary } = require('../../utils/plantBomAccess')
const { processBOMJob, inferFileFormat } = require('../../services/plant/bom.service')
const {
  generateConsolidatedExcel,
  groupItemsForConsolidation,
  uploadConsolidatedExcelToS3,
  loadBomItemsForJobs,
} = require('../../services/plant/consolidator.service')
const { sendConsolidatedBOMToVendor } = require('../../services/email/mailer')
const { buildVendorUploadPageUrl } = require('../../utils/vendorUpload.util')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

const BOM_CONFIRMED_STATUSES = ['bom_confirmed', 'completed']
const BOM_STARTED_STATUSES = ['bom_pending', 'bom_approved', 'bom_confirmed', 'completed']

const getAssignedLeadIds = async (req, query = req.query) => getScopedLeadIds(req, query)

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
  const { projectId, customerId, buildingType, search } = query
  let scopedLeadIds = leadIds

  if (projectId) {
    scopedLeadIds = leadIds.filter(id => String(id) === String(projectId))
  }

  const filter = { _id: { $in: scopedLeadIds } }

  if (customerId) filter.customerId = customerId
  if (buildingType) filter.buildingType = buildingType.trim()
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [{ projectName: regex }, { jobId: regex }]
  }

  return filter
}

const mapProjectRow = (lead, buildings = []) => {
  const customer = lead.customerId
  const clientName = formatClientName(customer)

  return {
    _id: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    projectId: lead.jobId || '',
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
  const leadIds = await getAssignedLeadIds(req, req.query)

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

  const leadIds = await getAssignedLeadIds(req, req.query)
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
  const result = await assertPlantProjectAccess(leadId, req)
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

  const jobId = leadLean.jobId || ''

  return success(res, {
    lead: enrichLeadDocument(leadLean),
    projectName: leadLean.projectName || '',
    jobId,
    projectId: jobId,
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

  const jobId = lead.jobId || ''

  return success(res, {
    leadId: lead._id,
    projectName: lead.projectName || '',
    jobId,
    projectId: jobId,
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

  const bomJobMap = await getLatestBomJobsByBuilding(leadId)

  return success(res, {
    leadId,
    projectName: lead.projectName || '',
    numberOfBuildings: lead.numberOfBuildings ?? buildings.length,
    buildings: buildings.map((b) => {
      const latest = getLatestDrawing(b.drawings)
      const latestBomJob = formatBomJobSummary(bomJobMap.get(String(b._id)))
      return {
        buildingId: b._id,
        buildingNumber: b.buildingNumber,
        status: b.status,
        latestDrawing: formatLatestDrawingSummary(latest),
        latestDrawingStatus: latest?.status || null,
        drawingCount: (b.drawings || []).length,
        hasDrawing: (b.drawings || []).length > 0,
        latestBomJob,
        hasBomJob: !!latestBomJob,
        bomJobStatus: latestBomJob?.status || null,
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

    await notifyCustomerDrawingUploaded({
      customerId: lead.customerId,
      leadId,
      lead,
      fileName: item.drawing.fileName,
      buildingNumber: item.buildingNumber,
      refId: item.buildingId,
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

exports.uploadProjectBom = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access
  const leadId = lead._id
  const { bomFiles: bomEntries } = req.body

  // TEMP: SMDT validation disabled — allow BOM upload without active cost version
  // const activeVersion = await getActiveCostVersion()
  // if (!activeVersion) {
  //   return badRequest(res, 'No active SMDT cost version. Upload SMDT cost list first.')
  // }

  const buildingIds = bomEntries.map((d) => String(d.buildingId))
  const uniqueIds = new Set(buildingIds)
  if (uniqueIds.size !== buildingIds.length) {
    return badRequest(res, 'Duplicate buildingId in bomFiles array')
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
  const jobs = []

  for (const entry of bomEntries) {
    const building = buildingMap.get(String(entry.buildingId))
    const fileName = entry.fileName.trim()
    const fileFormat = inferFileFormat(fileName, entry.fileFormat)

    await BOMItem.deleteMany({ buildingId: building._id })
    await BOMJob.deleteMany({ buildingId: building._id })

    const job = await BOMJob.create({
      leadId,
      buildingId: building._id,
      buildingNumber: building.buildingNumber,
      uploadedBy: req.user._id,
      fileName,
      fileUrl: entry.fileUrl.trim(),
      fileFormat,
      status: 'queued',
      isConfirmed: false,
    })

    // Any fresh upload invalidates prior confirmation for that building.
    building.status = 'bom_pending'
    await building.save()

    processBOMJob(
      job._id,
      job.fileUrl,
      job.fileName,
      job.fileFormat,
      leadId,
      building._id,
      building.buildingNumber,
      req.user._id
    ).catch((err) => console.error('[BOMJob] Background processing error:', err.message))

    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.BOM_JOB_STARTED,
      leadId,
      customerId: lead.customerId,
      performedBy: req.user._id,
      metadata: {
        bomJobId: job._id,
        buildingId: building._id,
        buildingNumber: building.buildingNumber,
        fileName,
      },
    })

    jobs.push({
      buildingId: building._id,
      buildingNumber: building.buildingNumber,
      bomJobId: job._id,
      status: job.status,
      fileName: job.fileName,
    })
  }

  return created(res, {
    leadId,
    jobs,
    message: `BOM extraction started for ${jobs.length} building(s). Poll job status until completed.`,
  }, 'BOM upload registered')
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

  const bomJobMap = await getLatestBomJobsByBuilding(leadId)

  const bomFiles = [...bomJobMap.values()].map((j) => ({
    buildingId: j.buildingId,
    buildingNumber: j.buildingNumber,
    bomJobId: j._id,
    fileName: j.fileName || '',
    fileUrl: j.fileUrl || '',
    fileFormat: j.fileFormat,
    status: j.status,
    uploadedAt: j.createdAt,
    totalItems: j.totalItems ?? 0,
    matchedItems: j.matchedItems ?? 0,
    unmatchedItems: j.unmatchedItems ?? 0,
    frameItems: j.frameItems ?? 0,
    isConfirmed: j.isConfirmed === true,
    extractionMethod: j.extractionMethod || 'exceljs',
    skippedSheets: j.skippedSheets || [],
    errorMessage: j.errorMessage || null,
  })).sort((a, b) => a.buildingNumber - b.buildingNumber)

  return success(res, { bomFiles })
})

exports.getProjectShipperFiles = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  const requests = sortShipperRequestsByLowestBid(
    await ShipperRequest.find({ leadId })
      .populate('vendorId', 'vendorName vendorCode email')
      .lean()
  )
  const bomCostById = await loadConsolidatedBomCostMap(requests)

  return success(res, {
    stats: computeShipperFilesStats(requests),
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
      amountComparison: buildAmountComparisonForRequest(r, bomCostById),
    })),
  })
})

const formatConsolidatedBOMResponse = (doc) => ({
  _id: doc._id,
  leadId: doc.leadId,
  status: doc.status,
  fileUrl: doc.fileUrl,
  totalCost: doc.totalCost,
  totalWeight: doc.totalWeight ?? 0,
  totalPanelsArea: doc.totalPanelsArea ?? 0,
  itemCount: doc.items?.length ?? 0,
  items: (doc.items || []).map((item) => ({
    _id: item._id,
    partCode: item.partCode,
    partColor: item.partColor,
    description: item.description,
    category: item.category,
    costUnit: item.costUnit,
    totalQty: item.totalQty,
    totalLengthFeet: item.totalLengthFeet,
    totalWeight: item.totalWeight,
    totalCost: item.totalCost,
    buildings: item.buildings,
    markIds: item.markIds,
  })),
  sentToVendors: (doc.sentToVendors || []).map((entry) => ({
    _id: entry._id,
    vendorId: entry.vendorId?._id || entry.vendorId,
    vendorName: entry.vendorId?.vendorName || '',
    sentAt: entry.sentAt,
  })),
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
})

const PANEL_AREA_CATEGORIES = /(panel|sheet)/i

exports.generateConsolidatedBOM = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return

  const { lead } = access
  const leadId = lead._id

  const buildings = await Building.find({ leadId })
    .sort({ buildingNumber: 1 })
    .lean()

  if (!buildings.length) {
    return badRequest(res, 'No buildings on this project')
  }

  const bomJobMap = await getLatestBomJobsByBuilding(leadId)
  const unconfirmedBuildings = []

  for (const building of buildings) {
    const job = bomJobMap.get(String(building._id))

    if (!job || job.status !== 'completed' || job.isConfirmed !== true) {
      unconfirmedBuildings.push(building.buildingNumber)
    }
  }

  if (unconfirmedBuildings.length) {
    return badRequest(
      res,
      'All buildings must have confirmed BOM before consolidation',
      { unconfirmedBuildings }
    )
  }

  const bomJobIds = buildings
    .map((building) => bomJobMap.get(String(building._id))?._id)
    .filter(Boolean)

  /**
   * Important:
   * Load items for the latest confirmed BOM jobs only (not all rows on buildingId).
   */
  const allItems = await loadBomItemsForJobs(bomJobIds)

  if (!allItems.length) {
    return badRequest(res, 'No BOM items found for this project')
  }

  // TEMP: SMDT/pricing validation disabled — allow consolidation with unpriced items
  // const unpricedItems = allItems.filter((item) => item.isPriced !== true)
  //
  // if (unpricedItems.length) {
  //   return badRequest(res, 'All BOM items must be priced before consolidation', {
  //     unpricedCount: unpricedItems.length,
  //     sample: unpricedItems.slice(0, 10).map((item) => ({
  //       _id: item._id,
  //       buildingId: item.buildingId,
  //       category: item.category,
  //       markId: item.markId,
  //       partCode: item.partCode,
  //       description: item.description,
  //       matchStatus: item.matchStatus,
  //       matchReason: item.matchReason,
  //     })),
  //   })
  // }

  const buildingMap = {}

  buildings.forEach((building) => {
    buildingMap[String(building._id)] = building.buildingNumber
  })

  const { buffer } = await generateConsolidatedExcel(
    lead,
    buildings,
    allItems
  )

  const groupedItems = groupItemsForConsolidation(allItems, buildingMap)
  const totalCost = groupedItems.reduce((sum, item) => sum + (item.totalCost || 0), 0)
  const totalWeight = groupedItems.reduce((sum, item) => sum + (item.totalWeight || 0), 0)
  const totalPanelsArea = groupedItems.reduce((sum, item) => {
    // Approx area in sq ft from total panel/sheet linear feet.
    if (!PANEL_AREA_CATEGORIES.test(String(item.category || ''))) return sum
    return sum + (Number(item.totalLengthFeet) || 0)
  }, 0)

  const { fileUrl } = await uploadConsolidatedExcelToS3(buffer, leadId)

  const existing = await ConsolidatedBOM.findOne({ leadId }).lean()

  const consolidatedBOM = await ConsolidatedBOM.findOneAndReplace(
    { leadId },
    {
      leadId,
      createdBy: existing?.createdBy || req.user._id,
      status: 'draft',
      fileUrl,
      totalCost,
      totalWeight,
      totalPanelsArea,
      items: groupedItems,
      sentToVendors: [],
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  )

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.CONSOLIDATED_BOM_GENERATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: {
      consolidatedBOMId: consolidatedBOM._id,
      totalCost,
      totalWeight,
      totalPanelsArea,
      itemCount: groupedItems.length,
      lineItemCount: allItems.length,
    },
  })

  return success(res, {
    consolidatedBOM: {
      _id: consolidatedBOM._id,
      status: consolidatedBOM.status,
      fileUrl: consolidatedBOM.fileUrl,
      totalCost: consolidatedBOM.totalCost,
      totalWeight: consolidatedBOM.totalWeight ?? totalWeight,
      totalPanelsArea: consolidatedBOM.totalPanelsArea ?? totalPanelsArea,
      itemCount: groupedItems.length,
      lineItemCount: allItems.length,
    },
  })
})

exports.getConsolidatedBOM = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const leadId = access.lead._id

  const consolidatedBOM = await ConsolidatedBOM.findOne({ leadId })
    .populate('sentToVendors.vendorId', 'vendorName vendorCode')
    .lean()

  if (!consolidatedBOM) {
    return notFound(res, 'Consolidated BOM not found. Generate one first.')
  }

  return success(res, {
    consolidatedBOM: formatConsolidatedBOMResponse(consolidatedBOM),
  })
})

exports.sendConsolidatedBOM = asyncHandler(async (req, res) => {
  const access = await guardProject(req, res)
  if (!access) return
  const { lead } = access
  const leadId = lead._id

  const { vendorIds } = req.body
  if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
    return badRequest(res, 'vendorIds array is required')
  }

  const uniqueVendorIds = [...new Set(vendorIds.map((id) => String(id)))]
  const consolidatedBOM = await ConsolidatedBOM.findOne({ leadId })
  if (!consolidatedBOM) {
    return notFound(res, 'Consolidated BOM not found. Generate one first.')
  }
  if (!consolidatedBOM.fileUrl) {
    return badRequest(res, 'Consolidated BOM file is missing. Regenerate first.')
  }

  const vendors = await Vendor.find({
    _id: { $in: uniqueVendorIds },
    status: 'active',
  }).select('_id vendorName email').lean()

  if (vendors.length !== uniqueVendorIds.length) {
    const found = new Set(vendors.map((v) => String(v._id)))
    const missing = uniqueVendorIds.filter((id) => !found.has(id))
    return badRequest(res, 'Some vendorIds are invalid or inactive', { invalidVendorIds: missing })
  }

  const missingEmail = vendors.filter((v) => !v.email).map((v) => String(v._id))
  if (missingEmail.length) {
    return badRequest(res, 'Some vendors do not have email configured', { missingEmailVendorIds: missingEmail })
  }

  const sent = []
  const sentRecords = []
  const failures = []
  const sentAt = new Date()

  for (const vendor of vendors) {
    let request = await ShipperRequest.findOne({
      leadId,
      consolidatedBOMId: consolidatedBOM._id,
      vendorId: vendor._id,
    })
    const isNewRequest = !request

    if (!request) {
      request = await ShipperRequest.create({
        leadId,
        consolidatedBOMId: consolidatedBOM._id,
        vendorId: vendor._id,
        token: crypto.randomBytes(32).toString('hex'),
        ourFileUrl: consolidatedBOM.fileUrl,
        sentAt,
        status: 'sent',
      })
    } else {
      request.ourFileUrl = consolidatedBOM.fileUrl
      request.sentAt = sentAt
      await request.save()
    }

    const uploadUrl = buildVendorUploadPageUrl(request.token)

    try {
      await sendConsolidatedBOMToVendor({
        toEmail: vendor.email,
        vendorName: vendor.vendorName,
        projectName: lead.projectName,
        jobId: lead.jobId,
        bomFileUrl: consolidatedBOM.fileUrl,
        uploadUrl,
      })

      sent.push({
        _id: request._id,
        vendorId: vendor._id,
        vendorName: vendor.vendorName,
        status: request.status,
        isNewRequest,
        tokenReused: !isNewRequest,
      })
      sentRecords.push({ vendorId: vendor._id, token: request.token, sentAt: request.sentAt })
    } catch (err) {
      failures.push({
        vendorId: vendor._id,
        vendorName: vendor.vendorName,
        email: vendor.email,
        error: err.message || 'Failed to send email',
      })
    }
  }

  if (!sent.length) {
    return badRequest(res, 'Failed to send consolidated BOM to selected vendors', { failures })
  }

  consolidatedBOM.status = 'sent_to_vendor'
  for (const item of sentRecords) {
    const idx = consolidatedBOM.sentToVendors.findIndex((v) => String(v.vendorId) === String(item.vendorId))
    if (idx >= 0) {
      consolidatedBOM.sentToVendors[idx].token = item.token
      consolidatedBOM.sentToVendors[idx].sentAt = item.sentAt
    } else {
      consolidatedBOM.sentToVendors.push({
        vendorId: item.vendorId,
        token: item.token,
        sentAt: item.sentAt,
      })
    }
  }
  await consolidatedBOM.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.CONSOLIDATED_BOM_SENT,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: {
      consolidatedBOMId: consolidatedBOM._id,
      vendorCount: sent.length,
      vendorIds: sent.map((v) => v.vendorId),
      failedVendorIds: failures.map((f) => f.vendorId),
    },
  })

  const message = failures.length
    ? `Sent to ${sent.length} vendor(s). ${failures.length} failed.`
    : `Sent to ${sent.length} vendor(s).`

  return success(res, {
    message,
    shipperRequests: sent,
    failures,
  })
})
