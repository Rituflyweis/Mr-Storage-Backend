const Task = require('../../models/Task')
const WorkLog = require('../../models/WorkLog')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
const Milestone = require('../../models/Milestone')
const ProjectStepDetail = require('../../models/ProjectStepDetail')
const { loadProjectPhasesPayload } = require('../../services/projectPhases.service')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const notificationService = require('../../services/notification.service')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { listConstructionTasks } = require('../../services/constructionTasksQuery.service')

exports.getTasks = asyncHandler(async (req, res) => {
  const { tasks, total, stats } = await listConstructionTasks(req.query)
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

  if (task.assignedTo) {
    await notificationService.notify({
      userId: task.assignedTo,
      leadId: task.leadId,
      title: 'New task assigned',
      body: `"${task.title}" on ${populated.leadId?.projectName || 'a project'}${task.dueDate ? ` — due ${new Date(task.dueDate).toLocaleDateString()}` : ''}`,
      type: 'task',
      priority: task.priority === 'high' ? 'high' : 'medium',
      refId: task._id,
      refModel: 'Task',
    })
  }

  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_TASK_CREATED,
    leadId: task.leadId,
    entityType: 'task',
    entityId: task._id,
    metadata: { title: task.title },
  })

  return success(res, { task: populated }, 'Task created')
})

exports.updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.taskId)
  if (!task) return notFound(res, 'Task not found')

  const { title, description, assignedTo, priority, status, dueDate, notes, attachments } = req.body
  const previousAssignedTo = task.assignedTo ? String(task.assignedTo) : null

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

  const nowAssignedTo = task.assignedTo ? String(task.assignedTo) : null
  if (nowAssignedTo && nowAssignedTo !== previousAssignedTo) {
    await notificationService.notify({
      userId: task.assignedTo,
      leadId: task.leadId,
      title: 'Task reassigned to you',
      body: `"${task.title}" on ${populated.leadId?.projectName || 'a project'}`,
      type: 'task',
      priority: task.priority === 'high' ? 'high' : 'medium',
      refId: task._id,
      refModel: 'Task',
    })
  }

  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_TASK_UPDATED,
    leadId: task.leadId,
    entityType: 'task',
    entityId: task._id,
    metadata: { title: task.title, status: task.status },
  })

  return success(res, { task: populated }, 'Task updated')
})

exports.deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.taskId)
  if (!task) return notFound(res, 'Task not found')
  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_TASK_DELETED,
    leadId: task.leadId,
    entityType: 'task',
    entityId: task._id,
    metadata: { title: task.title },
  })
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

  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_WORK_LOG_CREATED,
    leadId,
    entityType: 'work_log',
    entityId: log._id,
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

// GET /projects/:leadId/phases — lifecycle phases + granular steps with completion %
exports.getProjectPhases = asyncHandler(async (req, res) => {
  const payload = await loadProjectPhasesPayload(req.params.leadId)
  if (!payload) return notFound(res, 'Project not found')

  const { lead, progress, phases } = payload
  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId },
    phases,
    steps: progress.steps,
    overallProgressPct: progress.overallProgressPct,
    currentStepNumber: progress.currentStepNumber,
    totalSteps: progress.totalSteps,
    currentStepLabel: progress.currentStepLabel,
  })
})

// GET /projects/:leadId/progress — Progress Tracker tab for a single project
exports.getProjectProgress = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId)
    .select('projectName jobId endDate plannedStartDate lifecycleStatus lifecycleHistory')
    .lean()
  if (!lead) return notFound(res, 'Project not found')

  const payload = await loadProjectPhasesPayload(req.params.leadId)
  if (!payload) return notFound(res, 'Project not found')
  const { progress: stepProgress, phases } = payload

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
    phases,
    steps: stepProgress.steps,
    overallProgressPct: stepProgress.overallProgressPct,
    currentStepLabel: stepProgress.currentStepLabel,
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

  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_MILESTONE_CREATED,
    leadId: milestone.leadId,
    entityType: 'milestone',
    entityId: milestone._id,
    metadata: { title: milestone.title },
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

  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_MILESTONE_UPDATED,
    leadId: milestone.leadId,
    entityType: 'milestone',
    entityId: milestone._id,
    metadata: { title: milestone.title, status: milestone.status },
  })

  return success(res, { milestone }, 'Milestone updated')
})

const { STEP_KEYS } = ProjectStepDetail

// PUT /projects/:leadId/steps/:stepKey — "Current Step Details" panel on the customer's Project Tracking tab
exports.updateProjectStep = asyncHandler(async (req, res) => {
  const { leadId, stepKey } = req.params
  if (!STEP_KEYS.includes(stepKey)) return badRequest(res, `stepKey must be one of ${STEP_KEYS.join(', ')}`)

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const {
    startedBy,
    startedAt,
    completedBy,
    completedAt,
    currentStage,
    completionPct,
    percentComplete,
    expectedCompletion,
    notes,
    status,
    startDate,
    endDate,
    attachments,
  } = req.body

  const update = { updatedBy: req.user._id }
  if (startedBy !== undefined) update.startedBy = startedBy
  if (startedAt !== undefined) update.startedAt = startedAt
  if (startDate !== undefined) update.startedAt = startDate || null
  if (completedBy !== undefined) update.completedBy = completedBy
  if (completedAt !== undefined) update.completedAt = completedAt
  if (endDate !== undefined) update.completedAt = endDate || null
  if (currentStage !== undefined) update.currentStage = currentStage
  if (status !== undefined) update.currentStage = status
  const pct = percentComplete ?? completionPct
  if (pct !== undefined) update.completionPct = pct
  if (expectedCompletion !== undefined) update.expectedCompletion = expectedCompletion
  if (notes !== undefined) update.notes = notes

  let detail
  if (Array.isArray(attachments) && attachments.length) {
    const valid = attachments.filter((a) => a?.url?.trim()).map((a) => ({ name: a.name?.trim() || '', url: a.url.trim() }))
    detail = await ProjectStepDetail.findOneAndUpdate(
      { leadId, stepKey },
      {
        $set: update,
        ...(valid.length ? { $push: { attachments: { $each: valid } } } : {}),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  } else {
    detail = await ProjectStepDetail.findOneAndUpdate(
      { leadId, stepKey },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  }

  await auditService.logFromRequest(req, {
    type: 'construction',
    action: AUDIT_ACTIONS.CONSTRUCTION_PROJECT_STEP_UPDATED,
    leadId,
    entityType: 'project_step',
    metadata: { stepKey },
  })

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
