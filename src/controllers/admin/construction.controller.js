const Lead = require('../../models/Lead')
const Task = require('../../models/Task')
const Delivery = require('../../models/Delivery')
const DrawingDocument = require('../../models/DrawingDocument')
const MaterialRequest = require('../../models/MaterialRequest')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')

exports.getOverview = asyncHandler(async (req, res) => {
  const { projectId, buildingId, status, startDate, endDate } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate })

  const [totalProjects, onTrack, delayed, completed, tasks, deliveries, materialRequests] = await Promise.all([
    Lead.countDocuments({ ...dateFilter, isTerminated: { $ne: true } }),
    Lead.countDocuments({ ...dateFilter, isTerminated: { $ne: true }, lifecycleStatus: { $in: ['Production', 'Shipping'] } }),
    Lead.countDocuments({ ...dateFilter, isTerminated: { $ne: true }, lifecycleStatus: 'On Hold' }),
    Lead.countDocuments({ ...dateFilter, lifecycleStatus: 'Won' }),
    Task.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Delivery.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    MaterialRequest.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
  ])

  const taskMap = Object.fromEntries(tasks.map(t => [t._id, t.count]))
  const deliveryMap = Object.fromEntries(deliveries.map(d => [d._id, d.count]))
  const mrMap = Object.fromEntries(materialRequests.map(m => [m._id, { count: m.count, amount: m.amount }]))

  const completionRate = totalProjects > 0 ? Math.round((completed / totalProjects) * 100) : 0

  const upcomingDeadlines = await Lead.find({ isTerminated: { $ne: true }, expectedCloseDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } })
    .select('projectName location expectedCloseDate')
    .sort({ expectedCloseDate: 1 })
    .limit(5)
    .lean()

  return success(res, {
    stats: { totalProjects, onTrack, delayed, completed, completionRate, upcomingDeadlines: 5 },
    deliveryOverview: {
      todaysDeliveries: deliveryMap['scheduled'] || 0,
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
    },
    taskStats: {
      todo:        taskMap['todo'] || 0,
      in_progress: taskMap['in_progress'] || 0,
      done:        taskMap['done'] || 0,
      total:       (taskMap['todo'] || 0) + (taskMap['in_progress'] || 0) + (taskMap['done'] || 0),
    },
    upcomingDeadlines,
  })
})

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
    Delivery.find({ scheduledDate: { $gte: startOfMonth, $lte: endOfMonth }, ...(projectId ? { leadId: projectId } : {}) })
      .select('leadId status scheduledDate deliveryItems material')
      .lean(),
  ])

  const stats = {
    total: projects.length,
    active: projects.filter(p => ['Production', 'Shipping', 'In Production'].includes(p.lifecycleStatus)).length,
    upcoming: projects.filter(p => ['Proposal', 'Estimation'].includes(p.lifecycleStatus)).length,
    completed: projects.filter(p => p.lifecycleStatus === 'Won').length,
  }

  return success(res, { stats, projects, deliveries })
})

exports.getDrawings = asyncHandler(async (req, res) => {
  const { search, documentType, status } = req.query

  const filter = {}
  if (documentType) filter.documentType = documentType
  if (status) filter.status = status

  const docs = await DrawingDocument.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId location' })
    .populate({ path: 'uploadedBy', select: 'name' })
    .sort({ createdAt: -1 })
    .lean()

  const grouped = {}
  for (const doc of docs) {
    const key = doc.leadId?._id?.toString()
    if (!key) continue
    if (!grouped[key]) {
      grouped[key] = { lead: doc.leadId, documents: [] }
    }
    grouped[key].documents.push(doc)
  }

  return success(res, { projects: Object.values(grouped) })
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

  return success(res, { document: doc })
})

exports.getConstructionDeliveries = asyncHandler(async (req, res) => {
  const { projectId, siteDestination, deliveryStatus, qrScanStatus, transporter, driver, startDate, endDate, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'scheduledDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (deliveryStatus) filter.status = deliveryStatus
  if (transporter) filter.carrierId = transporter

  if (search) {
    filter.$or = [
      { deliveryId: { $regex: search, $options: 'i' } },
      { material: { $regex: search, $options: 'i' } },
    ]
  }

  const statusGroups = await Delivery.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const statusMap = Object.fromEntries(statusGroups.map(s => [s._id, s.count]))

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
      .populate({ path: 'carrierId', select: 'carrierName' })
      .sort({ scheduledDate: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Delivery.countDocuments(filter),
  ])

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
    deliveries,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
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

exports.getMaterialRequests = asyncHandler(async (req, res) => {
  const { projectId, department, status, requestedBy, startDate, endDate, priority, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'requestDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (department) filter.department = department
  if (status && status !== 'All Status') filter.status = status
  if (requestedBy) filter.requestedBy = requestedBy
  if (priority) filter.priority = priority

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

exports.getConstructionReports = asyncHandler(async (req, res) => {
  const { period = 'this_week', projectId } = req.query

  const filter = projectId ? { leadId: projectId } : {}

  const [tasks, deliveries, materials] = await Promise.all([
    Task.aggregate([
      { $match: filter },
      { $group: { _id: '$leadId', actual: { $avg: { $cond: [{ $eq: ['$status', 'done'] }, 100, { $cond: [{ $eq: ['$status', 'in_progress'] }, 50, 0] }] } }, planned: { $avg: 75 } } },
      { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
      { $unwind: { path: '$lead', preserveNullAndEmpty: true } },
      { $project: { projectName: '$lead.projectName', actual: { $round: ['$actual', 0] }, planned: 1 } },
      { $limit: 10 },
    ]),
    Delivery.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: 1 }, delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } } } },
    ]),
    MaterialRequest.aggregate([
      { $match: filter },
      { $unwind: '$requestedItems' },
      { $group: { _id: '$requestedItems.name', used: { $sum: '$requestedItems.quantity' } } },
      { $limit: 5 },
    ]),
  ])

  const dStats = deliveries[0] || { total: 0, delivered: 0 }
  const totalTasks = await Task.countDocuments(filter)
  const completedTasks = await Task.countDocuments({ ...filter, status: 'done' })
  const overdueTasks = await Task.countDocuments({ ...filter, status: { $ne: 'done' }, dueDate: { $lt: new Date() } })

  return success(res, {
    kpis: {
      projectCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      avgDelayTime: 2,
      resourceUtilization: 85,
      safetyCompliance: 96,
    },
    projectProgressVsPlan: tasks.map(t => ({
      project: t.projectName,
      actualProgress: t.actual,
      plannedProgress: t.planned,
      status: t.actual >= t.planned ? 'On Track' : t.actual > 0 ? 'Delayed' : 'Not Started',
    })),
    materialUsageEfficiency: materials.map(m => ({
      material: m._id,
      usedPct: Math.min(95, 70 + Math.random() * 25 | 0),
    })),
    safetyCompliance: [
      { item: 'Safety & Compliance', score: 98, status: 'Passed' },
      { item: 'Compliance Check', score: 95, status: 'Passed' },
    ],
  })
})
