const Task = require('../../models/Task')
const WorkLog = require('../../models/WorkLog')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
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
  const { title, description, leadId, assignedTo, priority, status, dueDate } = req.body
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

  const { title, description, assignedTo, priority, status, dueDate, notes } = req.body

  if (title !== undefined) task.title = title
  if (description !== undefined) task.description = description
  if (assignedTo !== undefined) task.assignedTo = assignedTo || null
  if (priority !== undefined) task.priority = priority
  if (notes !== undefined) task.notes = notes
  if (dueDate !== undefined) task.dueDate = dueDate || null
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
