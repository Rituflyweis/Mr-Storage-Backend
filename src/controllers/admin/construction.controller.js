const Lead = require('../../models/Lead')
const User = require('../../models/User')
const Task = require('../../models/Task')
const Delivery = require('../../models/Delivery')
const DrawingDocument = require('../../models/DrawingDocument')
const MaterialRequest = require('../../models/MaterialRequest')
const WorkLog = require('../../models/WorkLog')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { generateDeliveriesExcel, generateReportExcel, generateMaterialRequestsExcel } = require('../../utils/exportConstructionAdmin')
const { DELIVERY_STATUSES } = require('../../config/constants')
const { notifyCustomerDrawingUploadedForLabel } = require('../../services/customerNotification.service')

// The 5-phase "Project Timeline" bucket shown in Figma (Planning/Design/Procurement/
// Execution/Handover) mapped onto the real Lead.lifecycleStatus enum (sales + plant stages).
const TIMELINE_PHASE_DEFS = [
  { key: 'planning', label: 'Planning', stages: ['initial_contact', 'requirements_gathered'] },
  { key: 'design', label: 'Design', stages: ['proposal_sent', 'negotiation', 'deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin', 'released_to_plant', 'drawings_received'] },
  { key: 'procurement', label: 'Procurement', stages: ['bom_received', 'bom_review', 'material_check', 'production_planning'] },
  { key: 'execution', label: 'Execution', stages: ['fabrication_started', 'quality_inspection', 'packing_bundling', 'shipper_prepared', 'ready_for_delivery'] },
  { key: 'handover', label: 'Handover', stages: ['dispatched', 'delivered'] },
]

const computeProjectTimeline = (lead) => {
  const idx = TIMELINE_PHASE_DEFS.findIndex((p) => p.stages.includes(lead.lifecycleStatus))
  const currentIdx = idx === -1 ? 0 : idx
  return TIMELINE_PHASE_DEFS.map((phase, i) => {
    const entry = (lead.lifecycleHistory || []).filter((h) => phase.stages.includes(h.stage)).sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
    const status = i < currentIdx ? 'completed' : i === currentIdx ? 'in_progress' : 'upcoming'
    return {
      key: phase.key,
      label: phase.label,
      status,
      date: entry.length ? entry[0].changedAt : null,
    }
  })
}

exports.getOverview = asyncHandler(async (req, res) => {
  const { projectId, buildingLabel, status, startDate, endDate } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate })

  const leadFilter = { ...dateFilter, isTerminated: { $ne: true } }
  if (projectId) leadFilter._id = projectId
  if (status) leadFilter.lifecycleStatus = status

  const now = new Date()
  const [totalProjects, completed, delayed, tasks, deliveries, materialRequests] = await Promise.all([
    Lead.countDocuments(leadFilter),
    Lead.countDocuments({ ...leadFilter, lifecycleStatus: 'delivered' }),
    Lead.countDocuments({ ...leadFilter, lifecycleStatus: { $ne: 'delivered' }, expectedCloseDate: { $lt: now } }),
    Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Delivery.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    MaterialRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }]),
  ])
  const onTrack = totalProjects - completed - delayed

  const taskMap = Object.fromEntries(tasks.map(t => [t._id, t.count]))
  const deliveryMap = Object.fromEntries(deliveries.map(d => [d._id, d.count]))
  const mrMap = Object.fromEntries(materialRequests.map(m => [m._id, { count: m.count, amount: m.amount }]))

  const completionRate = totalProjects > 0 ? Math.round((completed / totalProjects) * 100) : 0

  const upcomingDeadlines = await Lead.find({ isTerminated: { $ne: true }, expectedCloseDate: { $gte: now, $lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) } })
    .select('projectName location expectedCloseDate')
    .sort({ expectedCloseDate: 1 })
    .limit(5)
    .lean()

  // "Additional Material Request" feed on the overview screen — most recent requests across all projects.
  const recentMaterialRequests = await MaterialRequest.find(buildingLabel ? { buildingLabel } : {})
    .populate('leadId', 'projectName jobId')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean()

  // "Live Site Construction" cards — one per active project, driven by real task-completion %.
  // NOTE: "Workers on site" / "Equipment in use" in the Figma design have no backing data model
  // anywhere in this codebase (no Worker/Equipment/Site collection exists) — returned as `null`
  // rather than fabricated. See docs for what a real implementation would need.
  const activeLeads = await Lead.find({ ...leadFilter, lifecycleStatus: { $ne: 'delivered' } })
    .select('projectName jobId location buildingType')
    .sort({ updatedAt: -1 })
    .limit(6)
    .lean()
  const activeLeadIds = activeLeads.map((l) => l._id)
  const [taskCountsByLead, timelineLeads] = await Promise.all([
    Task.aggregate([
      { $match: { leadId: { $in: activeLeadIds } } },
      { $group: { _id: { leadId: '$leadId', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Lead.find({ _id: { $in: activeLeadIds } }).select('lifecycleStatus lifecycleHistory').lean(),
  ])
  const taskCountMap = {}
  for (const row of taskCountsByLead) {
    const key = String(row._id.leadId)
    if (!taskCountMap[key]) taskCountMap[key] = { todo: 0, in_progress: 0, done: 0 }
    taskCountMap[key][row._id.status] = row.count
  }
  const timelineByLead = Object.fromEntries(timelineLeads.map((l) => [String(l._id), l]))

  const liveSiteConstruction = activeLeads.map((lead) => {
    const counts = taskCountMap[String(lead._id)] || { todo: 0, in_progress: 0, done: 0 }
    const totalTasks = counts.todo + counts.in_progress + counts.done
    return {
      leadId: lead._id,
      projectName: lead.projectName,
      jobId: lead.jobId,
      location: lead.location,
      progressPct: totalTasks > 0 ? Math.round((counts.done / totalTasks) * 100) : 0,
      tasks: totalTasks,
      workersOnSite: null,
      equipmentInUse: null,
      currentPhase: computeProjectTimeline(timelineByLead[String(lead._id)] || lead).find((p) => p.status === 'in_progress')?.label || null,
    }
  })

  // Bottom summary tiles — only the ones derivable from real data. workers/equipment omitted (see above).
  const [materialInTransit, totalMaterialDelivered] = await Promise.all([
    MaterialRequest.countDocuments({ status: 'approved' }),
    MaterialRequest.countDocuments({ status: 'fulfilled' }),
  ])

  return success(res, {
    stats: { totalProjects, onTrack, delayed, completed, completionRate, upcomingDeadlinesCount: upcomingDeadlines.length },
    deliveryOverview: {
      todaysDeliveries: await Delivery.countDocuments({ deliveryDate: { $gte: new Date(now.toDateString()) }, status: { $nin: ['draft', 'cancelled'] } }),
      delivered: deliveryMap['delivered'] || 0,
      inTransit: deliveryMap['in_transit'] || 0,
      delayed: deliveryMap['delayed'] || 0,
    },
    materialRequestOverview: {
      total:    (mrMap['pending']?.count || 0) + (mrMap['approved']?.count || 0) + (mrMap['rejected']?.count || 0),
      pending:  mrMap['pending']?.count || 0,
      approved: mrMap['approved']?.count || 0,
      rejected: mrMap['rejected']?.count || 0,
      pendingAmount: mrMap['pending']?.amount || 0,
      recent: recentMaterialRequests,
    },
    taskStats: {
      todo:        taskMap['todo'] || 0,
      in_progress: taskMap['in_progress'] || 0,
      done:        taskMap['done'] || 0,
      total:       (taskMap['todo'] || 0) + (taskMap['in_progress'] || 0) + (taskMap['done'] || 0),
    },
    upcomingDeadlines,
    liveSiteConstruction,
    liveSiteActivity: {
      activeSites: activeLeads.length,
      workersOnSite: null,
      equipmentInUse: null,
      ongoingTasks: taskMap['in_progress'] || 0,
      note: 'workersOnSite/equipmentInUse are not available yet — no Worker/Equipment data model exists in the backend.',
    },
    bottomStats: {
      totalSites: totalProjects,
      totalWorkers: null,
      materialInTransit,
      equipments: null,
      totalMaterialDelivered,
    },
  })
})

const SALES_STAGES = ['initial_contact', 'requirements_gathered', 'proposal_sent', 'negotiation']
const UPCOMING_STAGES = ['deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin']

exports.getProjectsCalendar = asyncHandler(async (req, res) => {
  const { month, year, projectId } = req.query
  const now = new Date()
  const targetYear = parseInt(year) || now.getFullYear()
  const targetMonth = parseInt(month) || now.getMonth() + 1

  const startOfMonth = new Date(targetYear, targetMonth - 1, 1)
  const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59)

  const filter = projectId ? { _id: projectId } : { isTerminated: { $ne: true } }

  const [projects, deliveries] = await Promise.all([
    Lead.find(filter).select('projectName jobId lifecycleStatus location').sort({ createdAt: -1 }).lean(),
    Delivery.find({ deliveryDate: { $gte: startOfMonth, $lte: endOfMonth }, ...(projectId ? { leadId: projectId } : {}) })
      .populate('leadId', 'projectName jobId')
      .select('leadId status deliveryDate deliveryNumber loadDescription materialType deliveryLocation')
      .lean(),
  ])

  const stats = {
    total: projects.length,
    active: projects.filter(p => !SALES_STAGES.includes(p.lifecycleStatus) && !UPCOMING_STAGES.includes(p.lifecycleStatus) && p.lifecycleStatus !== 'delivered').length,
    upcoming: projects.filter(p => SALES_STAGES.includes(p.lifecycleStatus) || UPCOMING_STAGES.includes(p.lifecycleStatus)).length,
    completed: projects.filter(p => p.lifecycleStatus === 'delivered').length,
  }

  return success(res, { stats, projects, deliveries })
})

// POST /projects-calendar/deliveries — "Add Delivery" modal
exports.createCalendarDelivery = asyncHandler(async (req, res) => {
  const { title, leadId, sectionLocation, deliveryDate, description, notes } = req.body
  if (!leadId) return badRequest(res, 'leadId is required')
  if (!deliveryDate) return badRequest(res, 'deliveryDate is required')

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const count = await Delivery.countDocuments({})
  const delivery = await Delivery.create({
    leadId,
    deliveryNumber: `DEL-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
    status: 'scheduled',
    loadDescription: title || '',
    description: description || '',
    deliveryLocation: sectionLocation || '',
    deliveryDate,
    additionalNotes: notes || '',
  })

  return created(res, { delivery }, 'Delivery added')
})

exports.getDrawings = asyncHandler(async (req, res) => {
  const { search, documentType, status, category, buildingLabel, projectId } = req.query

  const filter = {}
  if (documentType) filter.documentType = documentType
  if (status) filter.status = status
  if (category) filter.category = category
  if (buildingLabel) filter.buildingLabel = buildingLabel
  if (projectId) filter.leadId = projectId

  const docs = await DrawingDocument.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId location' })
    .populate({ path: 'uploadedBy', select: 'name' })
    .select('-comments')
    .sort({ createdAt: -1 })
    .lean()

  const grouped = {}
  for (const doc of docs) {
    const key = doc.leadId?._id?.toString()
    if (!key) continue
    if (!grouped[key]) {
      grouped[key] = {
        lead: doc.leadId,
        uploadedBy: doc.uploadedBy?.name || '',
        lastUpdate: doc.updatedAt,
        documents: [],
      }
    }
    grouped[key].documents.push(doc)
    if (doc.updatedAt > grouped[key].lastUpdate) grouped[key].lastUpdate = doc.updatedAt
  }

  return success(res, { projects: Object.values(grouped) })
})

// GET /drawings/:docId — preview modal (single drawing + comment thread)
exports.getDrawingDetail = asyncHandler(async (req, res) => {
  const doc = await DrawingDocument.findById(req.params.docId)
    .populate('leadId', 'projectName jobId location')
    .populate('uploadedBy', 'name')
    .populate('approvedBy', 'name')
    .populate('comments.commentedBy', 'name')
    .populate('comments.commentedByCustomer', 'firstName lastName')
    .lean()
  if (!doc) return notFound(res, 'Document not found')

  return success(res, { document: doc })
})

// POST /drawings/:docId/comments — "Send Comment" in the preview modal
exports.addDrawingComment = asyncHandler(async (req, res) => {
  const { text } = req.body
  if (!text?.trim()) return badRequest(res, 'text is required')

  const doc = await DrawingDocument.findById(req.params.docId)
  if (!doc) return notFound(res, 'Document not found')

  doc.comments.push({ text: text.trim(), commentedBy: req.user._id, authorName: req.user.name || '' })
  await doc.save()

  return created(res, { comment: doc.comments[doc.comments.length - 1] }, 'Comment added')
})

exports.uploadDrawing = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { name, fileUrl, fileType, fileSize, documentType, notes, buildingLabel, category } = req.body

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Project not found')

  const doc = await DrawingDocument.create({
    leadId, name, fileUrl: fileUrl || '', fileType, fileSize: fileSize || 0,
    documentType: documentType || 'other', notes: notes || '', uploadedBy: req.user._id,
    buildingLabel: buildingLabel || 'Building A',
    category: category || 'drawing',
  })

  if ((category || 'drawing') !== 'document') {
    await notifyCustomerDrawingUploadedForLabel({
      customerId: lead.customerId,
      leadId: lead._id,
      lead,
      fileName: name,
      buildingLabel: buildingLabel || 'Building A',
      refId: doc._id,
    })
  }

  return created(res, { document: doc })
})

exports.approveDrawing = asyncHandler(async (req, res) => {
  const doc = await DrawingDocument.findById(req.params.docId)
  if (!doc) return notFound(res, 'Document not found')

  doc.status = req.body.status || 'approved'
  doc.approvedBy = req.user._id
  doc.approvedAt = new Date()
  doc.notes = req.body.notes || doc.notes
  await doc.save()

  // Lets the Customer Panel invalidate/refetch its drawings query in real time instead of the
  // approval status appearing stale until the next manual refresh.
  if (global.io) {
    const payload = {
      documentId: String(doc._id),
      leadId: String(doc.leadId),
      status: doc.status,
      approvedAt: doc.approvedAt,
    }
    global.io.of('/chat').to(`lead:${doc.leadId}`).emit('drawing_status_updated', payload)
    global.io.of('/admin').to(`lead:${doc.leadId}`).emit('drawing_status_updated', payload)
  }

  return success(res, { document: doc })
})

// Resolves transporter/driver name filters through FreightBid -> FreightCarrier, since
// Delivery only stores `selectedCarrierBidId` — there's no carrierId/driver field on Delivery itself.
const resolveCarrierBidIds = async ({ transporter, driver }) => {
  if (!transporter && !driver) return null
  const carrierFilter = {}
  if (transporter) carrierFilter.carrierName = { $regex: transporter, $options: 'i' }
  if (driver) carrierFilter.contactName = { $regex: driver, $options: 'i' }

  const carriers = await FreightCarrier.find(carrierFilter).select('_id').lean()
  if (!carriers.length) return []
  const bids = await FreightBid.find({ carrierId: { $in: carriers.map(c => c._id) } }).select('_id').lean()
  return bids.map(b => b._id)
}

// GET /deliveries/filters — dropdown options for the All Deliveries filter bar
exports.getConstructionDeliveryFilters = asyncHandler(async (req, res) => {
  const [siteDestinations, carriers] = await Promise.all([
    Delivery.distinct('deliveryLocation', { deliveryLocation: { $ne: '' } }),
    FreightCarrier.find().select('carrierName contactName').lean(),
  ])

  return success(res, {
    deliveryStatuses: DELIVERY_STATUSES,
    siteDestinations,
    transporters: [...new Set(carriers.map(c => c.carrierName).filter(Boolean))],
    drivers: [...new Set(carriers.map(c => c.contactName).filter(Boolean))],
    note: 'No QR-scan tracking field exists on the Delivery model yet — "QR Scan Status" filter cannot be backed until that field/feature is added.',
  })
})

exports.getConstructionDeliveries = asyncHandler(async (req, res) => {
  const { projectId, siteDestination, deliveryStatus, transporter, driver, startDate, endDate, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'deliveryDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (deliveryStatus) filter.status = deliveryStatus
  if (siteDestination) filter.deliveryLocation = { $regex: siteDestination, $options: 'i' }

  const bidIds = await resolveCarrierBidIds({ transporter, driver })
  if (bidIds) filter.selectedCarrierBidId = { $in: bidIds }

  if (search) {
    filter.$or = [
      { deliveryNumber: { $regex: search, $options: 'i' } },
      { materialType: { $regex: search, $options: 'i' } },
      { loadDescription: { $regex: search, $options: 'i' } },
    ]
  }

  const statusGroups = await Delivery.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const statusMap = Object.fromEntries(statusGroups.map(s => [s._id, s.count]))

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
      .populate({ path: 'selectedCarrierBidId', select: 'carrierId', populate: { path: 'carrierId', select: 'carrierName contactName phone' } })
      .sort({ deliveryDate: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Delivery.countDocuments(filter),
  ])

  const rows = deliveries.map((d) => ({
    deliveryId: d._id,
    deliveryNumber: d.deliveryNumber,
    project: d.leadId ? { leadId: d.leadId._id, projectName: d.leadId.projectName, jobId: d.leadId.jobId } : null,
    material: d.materialType || d.loadDescription || '',
    deliveryDate: d.deliveryDate,
    timings: d.timings || '',
    transporter: d.selectedCarrierBidId?.carrierId?.carrierName || '',
    driver: d.selectedCarrierBidId?.carrierId?.contactName || '',
    driverPhone: d.selectedCarrierBidId?.carrierId?.phone || '',
    siteContact: d.receivingPoc || '',
    status: d.status,
  }))

  return success(res, {
    stats: {
      draft:      statusMap['draft'] || 0,
      total:      total,
      scheduled:  statusMap['scheduled'] || 0,
      confirmed:  statusMap['confirmed'] || 0,
      inTransit:  statusMap['in_transit'] || 0,
      delivered:  statusMap['delivered'] || 0,
      delayed:    statusMap['delayed'] || 0,
      cancelled:  statusMap['cancelled'] || 0,
    },
    deliveries: rows,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

// GET /deliveries/:deliveryId — delivery detail
exports.getConstructionDeliveryDetail = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
    .populate({ path: 'leadId', select: 'projectName jobId customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
    .populate({ path: 'selectedCarrierBidId', select: 'carrierId', populate: { path: 'carrierId', select: 'carrierName contactName phone' } })
    .lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  return success(res, {
    delivery: {
      deliveryId: delivery._id,
      deliveryNumber: delivery.deliveryNumber,
      project: delivery.leadId ? { leadId: delivery.leadId._id, projectName: delivery.leadId.projectName, jobId: delivery.leadId.jobId } : null,
      material: delivery.materialType || delivery.loadDescription || '',
      description: delivery.description || '',
      deliveryDate: delivery.deliveryDate,
      timings: delivery.timings || '',
      transporter: delivery.selectedCarrierBidId?.carrierId?.carrierName || '',
      driver: delivery.selectedCarrierBidId?.carrierId?.contactName || '',
      driverPhone: delivery.selectedCarrierBidId?.carrierId?.phone || '',
      siteContact: delivery.receivingPoc || '',
      deliveryLocation: delivery.deliveryLocation || '',
      additionalNotes: delivery.additionalNotes || '',
      status: delivery.status,
      statusHistory: delivery.statusHistory || [],
    },
  })
})

// GET /deliveries/export — "Export" button on the All Deliveries screen
exports.exportConstructionDeliveries = asyncHandler(async (req, res) => {
  const { projectId, siteDestination, deliveryStatus, transporter, driver, startDate, endDate } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'deliveryDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (deliveryStatus) filter.status = deliveryStatus
  if (siteDestination) filter.deliveryLocation = { $regex: siteDestination, $options: 'i' }
  const bidIds = await resolveCarrierBidIds({ transporter, driver })
  if (bidIds) filter.selectedCarrierBidId = { $in: bidIds }

  const deliveries = await Delivery.find(filter)
    .populate('leadId', 'projectName jobId')
    .populate({ path: 'selectedCarrierBidId', select: 'carrierId', populate: { path: 'carrierId', select: 'carrierName contactName' } })
    .sort({ deliveryDate: -1 })
    .lean()

  const rows = deliveries.map((d) => ({
    deliveryNumber: d.deliveryNumber,
    projectName: d.leadId?.projectName || '',
    jobId: d.leadId?.jobId || '',
    material: d.materialType || d.loadDescription || '',
    deliveryDate: d.deliveryDate,
    transporter: d.selectedCarrierBidId?.carrierId?.carrierName || '',
    driver: d.selectedCarrierBidId?.carrierId?.contactName || '',
    status: d.status,
  }))

  const buffer = await generateDeliveriesExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="construction-deliveries.xlsx"')
  return res.send(buffer)
})

exports.getTasks = asyncHandler(async (req, res) => {
  const { projectId, assignedTo, status, priority, startDate, endDate } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'dueDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (assignedTo) filter.assignedTo = assignedTo
  if (status) filter.status = status
  if (priority) filter.priority = priority

  const [tasks, total, statsAgg] = await Promise.all([
    Task.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'assignedTo', select: 'name email' })
      .sort({ createdAt: -1 })
      .lean(),
    Task.countDocuments(filter),
    Task.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ])

  const statsMap = Object.fromEntries(statsAgg.map(s => [s._id, s.count]))
  const now = new Date()
  const overdue = await Task.countDocuments({ status: { $ne: 'done' }, dueDate: { $lt: now } })

  const board = { todo: [], in_progress: [], done: [] }
  for (const task of tasks) {
    const key = task.status === 'in_progress' ? 'in_progress' : task.status
    if (board[key]) board[key].push(task)
  }

  return success(res, {
    stats: {
      total,
      completed: statsMap['done'] || 0,
      inProgress: statsMap['in_progress'] || 0,
      overdue,
    },
    board,
    tasks,
  })
})

exports.createTask = asyncHandler(async (req, res) => {
  const { title, description, leadId, assignedTo, priority, dueDate, notes } = req.body

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Project not found')

  const task = await Task.create({
    title, description, leadId, assignedTo: assignedTo || null, priority: priority || 'medium',
    dueDate: dueDate || null, notes: notes || '', createdBy: req.user._id,
  })

  return created(res, { task })
})

exports.updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.taskId)
  if (!task) return notFound(res, 'Task not found')

  const { title, description, status, priority, assignedTo, dueDate, notes } = req.body
  if (title !== undefined)       task.title = title
  if (description !== undefined) task.description = description
  if (status !== undefined) {
    task.status = status
    if (status === 'done') task.completedAt = new Date()
  }
  if (priority !== undefined)   task.priority = priority
  if (assignedTo !== undefined) task.assignedTo = assignedTo || null
  if (dueDate !== undefined)    task.dueDate = dueDate || null
  if (notes !== undefined)      task.notes = notes

  await task.save()
  return success(res, { task })
})

exports.deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.taskId)
  if (!task) return notFound(res, 'Task not found')
  await Task.deleteOne({ _id: task._id })
  return success(res, {}, 'Task deleted')
})

// GET /material-requests/filters — dropdown options for the All Materials filter bar
exports.getMaterialRequestFilters = asyncHandler(async (req, res) => {
  const [departments, requesterIds] = await Promise.all([
    MaterialRequest.distinct('department', { department: { $ne: '' } }),
    MaterialRequest.distinct('requestedBy', { requestedBy: { $ne: null } }),
  ])

  const requesters = await User.find({ _id: { $in: requesterIds } }).select('name role').lean()

  return success(res, {
    statuses: MaterialRequest.MR_STATUSES,
    priorities: MaterialRequest.MR_PRIORITIES,
    departments,
    requestedBy: requesters.map(u => ({ _id: u._id, name: u.name, role: u.role })),
  })
})

exports.getMaterialRequests = asyncHandler(async (req, res) => {
  const { projectId, department, status, requestedBy, startDate, endDate, priority, buildingLabel, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'requestDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (department) filter.department = department
  if (status && status !== 'All Status') filter.status = status
  if (requestedBy) filter.requestedBy = requestedBy
  if (priority) filter.priority = priority
  if (buildingLabel) filter.buildingLabel = buildingLabel

  const [requests, total, statsAgg] = await Promise.all([
    MaterialRequest.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId location' })
      .populate({ path: 'requestedBy', select: 'name role' })
      .sort({ requestDate: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    MaterialRequest.countDocuments(filter),
    MaterialRequest.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
  ])

  const statMap = Object.fromEntries(statsAgg.map(s => [s._id, { count: s.count, amount: s.amount }]))

  return success(res, {
    stats: {
      total,
      pending:  { count: statMap['pending']?.count || 0,  amount: statMap['pending']?.amount || 0 },
      approved: { count: statMap['approved']?.count || 0, amount: statMap['approved']?.amount || 0 },
      rejected: { count: statMap['rejected']?.count || 0, amount: statMap['rejected']?.amount || 0 },
    },
    requests,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

// GET /material-requests/:requestId — material request detail
exports.getMaterialRequestDetail = asyncHandler(async (req, res) => {
  const request = await MaterialRequest.findById(req.params.requestId)
    .populate({ path: 'leadId', select: 'projectName jobId location' })
    .populate({ path: 'requestedBy', select: 'name role' })
    .populate({ path: 'reviewedBy', select: 'name role' })
    .lean()
  if (!request) return notFound(res, 'Request not found')

  return success(res, { request })
})

// POST /material-requests/:requestId/attachments — "Send Photo" / "Upload Photo" modal
// Client uploads the file to S3 via the presigned-URL flow (POST /upload/presigned-url) first,
// then calls this with the resulting { name, url } to attach it to the request.
exports.addMaterialRequestAttachment = asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const { name, url, fileSize } = req.body
  if (!url) return badRequest(res, 'url is required')

  const request = await MaterialRequest.findById(requestId)
  if (!request) return notFound(res, 'Request not found')

  request.attachments.push({ name: name || '', url, fileSize: fileSize || 0 })
  await request.save()

  return created(res, { attachments: request.attachments })
})

// GET /material-requests/:requestId/attachments/:index/download — redirect to stored S3 file
exports.downloadMaterialRequestAttachment = asyncHandler(async (req, res) => {
  const { requestId, index } = req.params

  const request = await MaterialRequest.findById(requestId).select('attachments').lean()
  if (!request) return notFound(res, 'Request not found')

  const attachment = request.attachments?.[Number(index)]
  if (!attachment) return notFound(res, 'Attachment not found')

  return res.redirect(attachment.url)
})

exports.createMaterialRequest = asyncHandler(async (req, res) => {
  const { leadId, siteLocation, department, requestedItems, requiredBy, priority, totalAmount } = req.body

  const count = await MaterialRequest.countDocuments()
  const requestId = `MR-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`

  const request = await MaterialRequest.create({
    requestId, leadId, siteLocation, department, requestedBy: req.user._id,
    requestedItems: requestedItems || [], requiredBy: requiredBy || null,
    priority: priority || 'medium', totalAmount: totalAmount || 0,
  })

  return created(res, { request })
})

exports.reviewMaterialRequest = asyncHandler(async (req, res) => {
  const request = await MaterialRequest.findById(req.params.requestId)
  if (!request) return notFound(res, 'Request not found')

  const { action, reviewNotes } = req.body
  if (!['approved', 'rejected'].includes(action)) return badRequest(res, 'action must be approved or rejected')

  request.status = action
  request.reviewedBy = req.user._id
  request.reviewedAt = new Date()
  request.reviewNotes = reviewNotes || ''
  await request.save()

  return success(res, { request })
})

// GET /material-requests/export
exports.exportMaterialRequests = asyncHandler(async (req, res) => {
  const { projectId, department, status, buildingLabel, startDate, endDate } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'requestDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (department) filter.department = department
  if (status && status !== 'All Status') filter.status = status
  if (buildingLabel) filter.buildingLabel = buildingLabel

  const requests = await MaterialRequest.find(filter)
    .populate('leadId', 'projectName jobId')
    .populate('requestedBy', 'name')
    .sort({ requestDate: -1 })
    .lean()

  const rows = requests.map((r) => ({
    requestId: r.requestId,
    projectName: r.leadId?.projectName || '',
    department: r.department,
    itemCount: r.requestedItems?.length || 0,
    requestedBy: r.requestedBy?.name || '',
    requestDate: r.requestDate,
    requiredBy: r.requiredBy,
    priority: r.priority,
    status: r.status,
  }))

  const buffer = await generateMaterialRequestsExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="material-requests.xlsx"')
  return res.send(buffer)
})

const PERIOD_DAYS = { this_week: 7, last_3_weeks: 21, this_month: 30, last_6_months: 182, this_year: 365 }

const buildPeriodFilter = (period, field = 'createdAt') => {
  const days = PERIOD_DAYS[period]
  if (!days) return {}
  return { [field]: { $gte: new Date(Date.now() - days * 86400000) } }
}

exports.getConstructionReports = asyncHandler(async (req, res) => {
  const { period = 'this_week', projectId } = req.query

  const leadFilter = projectId ? { leadId: projectId } : {}
  const taskFilter = { ...leadFilter, ...buildPeriodFilter(period, 'createdAt') }
  const deliveryFilter = { ...leadFilter, ...buildPeriodFilter(period, 'deliveryDate') }
  const materialFilter = { ...leadFilter, ...buildPeriodFilter(period, 'requestDate') }

  const [tasks, materials] = await Promise.all([
    Task.aggregate([
      { $match: taskFilter },
      { $group: { _id: '$leadId', actual: { $avg: { $cond: [{ $eq: ['$status', 'done'] }, 100, { $cond: [{ $eq: ['$status', 'in_progress'] }, 50, 0] }] } } } },
      { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
      { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
      { $project: { projectName: '$lead.projectName', actual: { $round: ['$actual', 0] } } },
      { $limit: 10 },
    ]),
    // Real usage: quantity requested vs quantity that actually made it through a fulfilled request.
    MaterialRequest.aggregate([
      { $match: materialFilter },
      { $unwind: '$requestedItems' },
      { $group: {
        _id: '$requestedItems.name',
        requestedQty: { $sum: '$requestedItems.quantity' },
        fulfilledQty: { $sum: { $cond: [{ $eq: ['$status', 'fulfilled'] }, '$requestedItems.quantity', 0] } },
      } },
      { $limit: 10 },
    ]),
  ])

  const totalTasks = await Task.countDocuments(taskFilter)
  const completedTasks = await Task.countDocuments({ ...taskFilter, status: 'done' })
  const overdueTasks = await Task.find({ ...leadFilter, status: { $ne: 'done' }, dueDate: { $lt: new Date() } }).select('dueDate').lean()
  const avgDelayTime = overdueTasks.length
    ? Math.round((overdueTasks.reduce((sum, t) => sum + (Date.now() - new Date(t.dueDate).getTime()), 0) / overdueTasks.length / 86400000) * 10) / 10
    : 0

  return success(res, {
    kpis: {
      projectCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      avgDelayTimeDays: avgDelayTime,
      // No Worker/Equipment/Safety data model exists yet — these two are not fabricated.
      resourceUtilization: null,
      safetyCompliance: null,
    },
    projectProgressVsPlan: tasks.map(t => ({
      project: t.projectName,
      actualProgress: t.actual,
      status: t.actual >= 75 ? 'On Track' : t.actual > 0 ? 'Delayed' : 'Not Started',
    })),
    materialUsageEfficiency: materials.map(m => ({
      material: m._id,
      requestedQty: m.requestedQty,
      fulfilledQty: m.fulfilledQty,
      usedPct: m.requestedQty > 0 ? Math.round((m.fulfilledQty / m.requestedQty) * 100) : 0,
    })),
    safetyCompliance: [],
    note: 'resourceUtilization, safetyCompliance KPIs and the Safety & Compliance table are not backed by any data model yet — no Safety/Compliance/Resource-tracking collection exists in the backend.',
  })
})

// GET /reports/export — "Export Report" button
exports.exportConstructionReport = asyncHandler(async (req, res) => {
  const { period = 'this_week', projectId } = req.query
  const leadFilter = projectId ? { leadId: projectId } : {}
  const taskFilter = { ...leadFilter, ...buildPeriodFilter(period, 'createdAt') }

  const tasks = await Task.aggregate([
    { $match: taskFilter },
    { $group: { _id: '$leadId', actual: { $avg: { $cond: [{ $eq: ['$status', 'done'] }, 100, { $cond: [{ $eq: ['$status', 'in_progress'] }, 50, 0] }] } } } },
    { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
    { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
    { $project: { projectName: '$lead.projectName', jobId: '$lead.jobId', actual: { $round: ['$actual', 0] } } },
  ])

  const buffer = await generateReportExcel(tasks)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="construction-report.xlsx"')
  return res.send(buffer)
})

// ── Daily Work Log ──────────────────────────────────────────────────────────────

// GET /work-logs
exports.getWorkLogs = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId

  const [logs, total] = await Promise.all([
    WorkLog.find(filter)
      .populate('leadId', 'projectName jobId')
      .populate('taskId', 'title')
      .populate('loggedBy', 'name')
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    WorkLog.countDocuments(filter),
  ])

  return success(res, { logs, total, page: parseInt(page), limit: parseInt(limit) })
})

// POST /work-logs — "Daily Work Log" modal
exports.createWorkLog = asyncHandler(async (req, res) => {
  const { leadId, taskId, date, progress, description, photos, issues } = req.body
  if (!leadId) return badRequest(res, 'leadId is required')
  if (!date) return badRequest(res, 'date is required')

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const log = await WorkLog.create({
    leadId, taskId: taskId || null, loggedBy: req.user._id, date,
    progress: progress || 0, description: description || '', photos: photos || [], issues: issues || '',
  })

  return created(res, { log }, 'Work log created')
})
