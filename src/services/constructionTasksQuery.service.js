const Task = require('../models/Task')

const TASK_LIST_POPULATE = [
  { path: 'leadId', select: 'projectName jobId' },
  { path: 'assignedTo', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
]

const buildTaskListFilter = (query = {}) => {
  const { leadId, status, priority, assignedTo, search, startDate, endDate } = query
  const filter = {}
  if (leadId) filter.leadId = leadId
  if (status) filter.status = status
  if (priority) filter.priority = priority
  if (assignedTo) filter.assignedTo = assignedTo
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [{ title: regex }, { description: regex }]
  }
  if (startDate || endDate) {
    filter.dueDate = {}
    if (startDate) filter.dueDate.$gte = new Date(startDate)
    if (endDate) filter.dueDate.$lte = new Date(endDate)
  }
  return filter
}

const taskStatsForLead = async (leadId) => {
  const scope = leadId ? { leadId } : {}
  const now = new Date()
  return {
    total: await Task.countDocuments(scope),
    todo: await Task.countDocuments({ ...scope, status: 'todo' }),
    inProgress: await Task.countDocuments({ ...scope, status: 'in_progress' }),
    done: await Task.countDocuments({ ...scope, status: 'done' }),
    overdue: await Task.countDocuments({
      ...scope,
      dueDate: { $lt: now },
      status: { $ne: 'done' },
    }),
  }
}

const listConstructionTasks = async (query = {}) => {
  const { page = 1, limit = 50 } = query
  const filter = buildTaskListFilter(query)
  const skip = (Number(page) - 1) * Number(limit)

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .populate(TASK_LIST_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Task.countDocuments(filter),
  ])

  const stats = await taskStatsForLead(query.leadId || null)

  return { tasks, total, stats }
}

module.exports = {
  buildTaskListFilter,
  listConstructionTasks,
  taskStatsForLead,
  TASK_LIST_POPULATE,
}
