const Task = require('../../models/Task')
const WorkLog = require('../../models/WorkLog')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
const Milestone = require('../../models/Milestone')
const ProjectStepDetail = require('../../models/ProjectStepDetail')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getTasks = asyncHandler(async (req, res) => {
  const { leadId, status, priority, assignedTo, page = 1, limit = 50 } = req.query

  const filter = {}
  if (leadId) filter.leadId = leadId
  if (status) filter.status = status
  if (priority) filter.priority = priority
  if (assignedTo) filter.assignedTo = assignedTo

  const skip = (Number(page) - 1) * Number(limit)
  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .populate('leadId', 'projectName jobId')
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Task.countDocuments(filter),
  ])

  const stats = {
    total: await Task.countDocuments(leadId ? { leadId } : {}),
    todo: await Task.countDocuments({ ...(leadId ? { leadId } : {}), status: 'todo' }),
    inProgress: await Task.countDocuments({ ...(leadId ? { leadId } : {}), status: 'in_progress' }),
    done: await Task.countDocuments({ ...(leadId ? { leadId } : {}), status: 'done' }),
    overdue: await Task.countDocuments({
      ...(leadId ? { leadId } : {}),
      dueDate: { $lt: new Date() },
      status: { $ne: 'done' },
    }),
  }

  return success(res, { tasks, total, stats })
})

exports.createTask = asyncHandler(async (req, res) => {
  const { title, description, leadId, assignedTo, priority, status, dueDate, attachments } = req.body
  if (!title || !leadId) return badRequest(res, 'title and leadId are required')

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const task = await Task.create({
    title,
    description,
    leadId,
    assignedTo: assignedTo || null,
    createdBy: req.user._id,
    priority: priority || 'medium',
    status: status || 'todo',
    dueDate: dueDate || null,
    attachments: Array.isArray(attachments) ? attachments : [],
  })

  const populated = await Task.findById(task._id)
    .populate('leadId', 'projectName jobId')
    .populate('assignedTo', 'name email')
    .lean()

  return success(res, { task: populated }, 'Task created')
})

exports.updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.taskId)
  if (!task) return notFound(res, 'Task not found')

  const { title, description, assignedTo, priority, status, dueDate, notes, attachments } = req.body

  if (title !== undefined) task.title = title
  if (description !== undefined) task.description = description
  if (assignedTo !== undefined) task.assignedTo = assignedTo || null
  if (priority !== undefined) task.priority = priority
  if (notes !== undefined) task.notes = notes
  if (dueDate !== undefined) task.dueDate = dueDate || null
  if (attachments !== undefined) task.attachments = Array.isArray(attachments) ? attachments : []
  if (status !== undefined) {
    task.status = status
    if (status === 'done' && !task.completedAt) task.completedAt = new Date()
    if (status !== 'done') task.completedAt = null
  }

  await task.save()

  const populated = await Task.findById(task._id)
    .populate('leadId', 'projectName jobId')
    .populate('assignedTo', 'name email')
    .lean()

  return success(res, { task: populated }, 'Task updated')
})

exports.deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.taskId)
  if (!task) return notFound(res, 'Task not found')
  return success(res, {}, 'Task deleted')
})

exports.createWorkLog = asyncHandler(async (req, res) => {
  const { leadId, taskId, date, progress, description, photos, issues } = req.body
  if (!leadId || !date) return badRequest(res, 'leadId and date are required')

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const log = await WorkLog.create({
    leadId,
    taskId: taskId || null,
    loggedBy: req.user._id,
    date: new Date(date),
    progress: progress || 0,
    description: description || '',
    photos: photos || [],
    issues: issues || '',
  })

  return success(res, { workLog: log }, 'Work log created')
})

exports.getWorkLogs = asyncHandler(async (req, res) => {
  const { leadId, page = 1, limit = 20 } = req.query
  const filter = {}
  if (leadId) filter.leadId = leadId

  const skip = (Number(page) - 1) * Number(limit)
  const [logs, total] = await Promise.all([
    WorkLog.find(filter)
      .populate('leadId', 'projectName jobId')
      .populate('loggedBy', 'name email')
      .populate('taskId', 'title')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    WorkLog.countDocuments(filter),
  ])

  return success(res, { logs, total })
})

// ── Progress Tracker (Tasks & Progress screen) ───────────────────────────────

// GET /tasks/stats — top stat cards: Total Tasks, Completed, In Progress, Overdue
exports.getTaskStats = asyncHandler(async (req, res) => {
  const stats = {
    total: await Task.countDocuments({}),
    completed: await Task.countDocuments({ status: 'done' }),
    inProgress: await Task.countDocuments({ status: 'in_progress' }),
    overdue: await Task.countDocuments({ dueDate: { $lt: new Date() }, status: { $ne: 'done' } }),
  }
  return success(res, { stats })
})

// GET /projects/:leadId/progress — Progress Tracker tab for a single project
exports.getProjectProgress = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId).select('projectName jobId endDate plannedStartDate').lean()
  if (!lead) return notFound(res, 'Project not found')

  const [tasks, milestones] = await Promise.all([
    Task.find({ leadId: lead._id }).select('status').lean(),
    Milestone.find({ leadId: lead._id }).sort({ order: 1, targetDate: 1 }).lean(),
  ])

  const completed = tasks.filter(t => t.status === 'done').length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const pending = tasks.filter(t => t.status === 'todo').length
  const total = tasks.length

  const now = new Date()
  const plannedCompletion = lead.endDate || null
  const currentEstimate = plannedCompletion // no separate "re-forecast" field on Lead today; mirrors planned until one exists
  const timelineStatus = plannedCompletion && new Date(plannedCompletion) < now && completed < total ? 'Delayed' : 'On Track'

  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId },
    taskProgress: {
      completed, inProgress, pending, total,
      completedFraction: `${completed}/${total}`,
      completedPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    timeline: {
      plannedCompletion,
      currentEstimate,
      status: plannedCompletion ? timelineStatus : 'Unscheduled',
    },
    milestones: milestones.map(m => ({
      milestoneId: m._id,
      title: m.title,
      status: m.status,
      targetDate: m.targetDate,
      completedAt: m.completedAt,
    })),
  })
})

// POST /projects/:leadId/milestones
exports.createMilestone = asyncHandler(async (req, res) => {
  const { title, targetDate, order } = req.body
  if (!title) return badRequest(res, 'title is required')

  const lead = await Lead.findById(req.params.leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const milestone = await Milestone.create({
    leadId: req.params.leadId,
    title,
    targetDate: targetDate || null,
    order: order ?? 0,
    createdBy: req.user._id,
  })

  return success(res, { milestone }, 'Milestone created')
})

// PUT /milestones/:milestoneId
exports.updateMilestone = asyncHandler(async (req, res) => {
  const milestone = await Milestone.findById(req.params.milestoneId)
  if (!milestone) return notFound(res, 'Milestone not found')

  const { title, status, targetDate } = req.body
  if (title !== undefined) milestone.title = title
  if (targetDate !== undefined) milestone.targetDate = targetDate || null
  if (status !== undefined) {
    milestone.status = status
    milestone.completedAt = status === 'completed' ? new Date() : null
  }

  await milestone.save()
  return success(res, { milestone }, 'Milestone updated')
})

const { STEP_KEYS } = ProjectStepDetail

// PUT /projects/:leadId/steps/:stepKey — "Current Step Details" panel on the customer's Project Tracking tab
exports.updateProjectStep = asyncHandler(async (req, res) => {
  const { leadId, stepKey } = req.params
  if (!STEP_KEYS.includes(stepKey)) return badRequest(res, `stepKey must be one of ${STEP_KEYS.join(', ')}`)

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const { startedBy, startedAt, completedBy, completedAt, currentStage, completionPct, expectedCompletion, notes } = req.body

  const update = { updatedBy: req.user._id }
  if (startedBy !== undefined) update.startedBy = startedBy
  if (startedAt !== undefined) update.startedAt = startedAt
  if (completedBy !== undefined) update.completedBy = completedBy
  if (completedAt !== undefined) update.completedAt = completedAt
  if (currentStage !== undefined) update.currentStage = currentStage
  if (completionPct !== undefined) update.completionPct = completionPct
  if (expectedCompletion !== undefined) update.expectedCompletion = expectedCompletion
  if (notes !== undefined) update.notes = notes

  const detail = await ProjectStepDetail.findOneAndUpdate(
    { leadId, stepKey },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  return success(res, { stepDetail: detail }, 'Project step updated')
})

// POST /projects/:leadId/steps/:stepKey/attachments — add a file to a step's "Attachments & Documents"
exports.addProjectStepAttachment = asyncHandler(async (req, res) => {
  const { leadId, stepKey } = req.params
  if (!STEP_KEYS.includes(stepKey)) return badRequest(res, `stepKey must be one of ${STEP_KEYS.join(', ')}`)

  const { name, url } = req.body
  if (!url) return badRequest(res, 'url is required')

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const detail = await ProjectStepDetail.findOneAndUpdate(
    { leadId, stepKey },
    { $push: { attachments: { name: name || '', url } }, $set: { updatedBy: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )

  return success(res, { stepDetail: detail }, 'Attachment added')
})
