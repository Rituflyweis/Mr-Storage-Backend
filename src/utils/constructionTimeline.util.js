const Lead = require('../models/Lead')
const Task = require('../models/Task')
const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')
const { enrichConstructionTaskForCard } = require('./constructionTaskCard.util')
const {
  CONSTRUCTION_TIMELINE_PHASES,
  computeProjectSteps,
  buildPhasesFromSteps,
} = require('./computeProjectSteps')

const MS_PER_DAY = 86400000

const startOfLocalDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

const historyDateForStage = (history, stage) => {
  const entries = (history || [])
    .filter((h) => h.stage === stage)
    .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
  return entries.length ? entries[entries.length - 1].changedAt : null
}

/**
 * Open construction timeline tasks (Task collection) — Admin Construction overview
 * and Construction Panel "Upcoming Schedule" (start / est. end / badges).
 */
const loadUpcomingConstructionTasks = async ({
  leadFilter = {},
  projectId = null,
  leadIds = null,
  daysAhead = 30,
  limit = 10,
} = {}) => {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + Math.max(1, daysAhead) * MS_PER_DAY)

  let scopedLeadIds = leadIds
  if (projectId) {
    scopedLeadIds = [projectId]
  } else if (!scopedLeadIds?.length && Object.keys(leadFilter).length) {
    const leads = await Lead.find(leadFilter).select('_id').lean()
    scopedLeadIds = leads.map((l) => l._id)
    if (!scopedLeadIds.length) {
      return { tasks: [], count: 0 }
    }
  }

  const taskFilter = {
    status: { $ne: 'done' },
    dueDate: { $ne: null, $lte: windowEnd },
  }
  if (scopedLeadIds?.length) taskFilter.leadId = { $in: scopedLeadIds }

  const [rawTasks, count] = await Promise.all([
    Task.find(taskFilter)
      .select(
        'title description leadId assignedTo priority status startDate dueDate completedAt notes createdAt updatedAt'
      )
      .populate('assignedTo', 'name email')
      .sort({ dueDate: 1 })
      .limit(Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50))
      .lean(),
    Task.countDocuments(taskFilter),
  ])

  const taskLeadIds = [...new Set(rawTasks.map((t) => String(t.leadId)))]
  const projects = taskLeadIds.length
    ? await Lead.find({ _id: { $in: taskLeadIds } })
        .select('projectName jobId location lifecycleStatus')
        .lean()
    : []
  const projectMap = Object.fromEntries(projects.map((p) => [String(p._id), p]))
  const today = startOfLocalDay(now)

  const tasks = rawTasks.map((t) => {
    const card = enrichConstructionTaskForCard(t)
    const project = projectMap[String(t.leadId)] || null
    const est = card.estimatedEndDate ? startOfLocalDay(card.estimatedEndDate) : null
    const daysLeft = est ? Math.round((est - today) / MS_PER_DAY) : null
    return {
      taskId: t._id,
      title: card.title,
      status: card.status,
      priority: card.priority,
      startDate: card.startDate,
      estimatedEndDate: card.estimatedEndDate,
      completedDate: card.completedDate,
      timelineBadge: card.timelineBadge,
      timelineStatusLine: card.timelineStatusLine,
      onTimeStatus: card.onTimeStatus,
      daysLeft,
      assignedTo: t.assignedTo
        ? { _id: t.assignedTo._id, name: t.assignedTo.name, email: t.assignedTo.email }
        : null,
      project: project
        ? {
            leadId: project._id,
            projectName: project.projectName || '',
            jobId: project.jobId || '',
            location: project.location || '',
            lifecycleStatus: project.lifecycleStatus || '',
          }
        : { leadId: t.leadId, projectName: '', jobId: '', location: '', lifecycleStatus: '' },
    }
  })

  return { tasks, count }
}

const mapUpcomingScheduleRows = (tasks) =>
  tasks.map((t) => ({
    taskId: t.taskId,
    title: t.title,
    projectName: t.project.projectName,
    location: t.project.location || '',
    site: t.project.location || '',
    startDate: t.startDate,
    estimatedEndDate: t.estimatedEndDate,
    completedDate: t.completedDate,
    endDate: t.estimatedEndDate,
    expectedCloseDate: t.estimatedEndDate,
    timelineBadge: t.timelineBadge,
    timelineStatusLine: t.timelineStatusLine,
    daysLeft: t.daysLeft,
    status: t.status,
    assignedTo: t.assignedTo,
    project: t.project,
  }))

/** Aggregated 5-phase timeline across scoped construction leads (dashboard widget). */
const buildOverallTimelineFromLeads = (leads) => {
  const now = Date.now()
  return CONSTRUCTION_TIMELINE_PHASES.map((phase) => {
    let earliestDate = null
    let anyReached = false
    let anyCurrent = false
    let allPast = leads.length > 0

    for (const lead of leads) {
      const idx = PLANT_LIFECYCLE_STAGES.indexOf(lead.lifecycleStatus)
      const firstStageIdx = PLANT_LIFECYCLE_STAGES.indexOf(phase.stages[0])
      const lastStageIdx = PLANT_LIFECYCLE_STAGES.indexOf(phase.stages[phase.stages.length - 1])

      const reached = idx >= firstStageIdx && firstStageIdx >= 0
      const past = idx > lastStageIdx && lastStageIdx >= 0
      const current = idx >= firstStageIdx && idx <= lastStageIdx && firstStageIdx >= 0

      if (reached) anyReached = true
      if (current) anyCurrent = true
      if (!past) allPast = false

      for (const stage of phase.stages) {
        const d = historyDateForStage(lead.lifecycleHistory, stage)
        if (d && (!earliestDate || new Date(d) < new Date(earliestDate))) {
          earliestDate = d
        }
      }
    }

    let status = 'Upcoming'
    if (!leads.length) status = 'Upcoming'
    else if (allPast) status = 'Completed'
    else if (anyCurrent || (anyReached && !allPast)) status = 'Inprogress'
    else status = 'Upcoming'

    if (status === 'Upcoming' && earliestDate && new Date(earliestDate).getTime() > now) {
      status = 'Upcoming'
    }

    return {
      key: phase.key,
      label: phase.label,
      date: earliestDate,
      status,
    }
  })
}

/** Single-project 5-phase timeline (Planning → Handover) for construction panel detail. */
const buildProjectTimelineBreakdown = (lead, stepDetails = []) => {
  const progress = computeProjectSteps(lead, stepDetails)
  const phases = buildPhasesFromSteps(lead, progress.steps)
  return {
    timeline: phases.map((p) => ({
      key: p.key,
      label: p.label,
      date: p.date,
      status: p.status,
      percentComplete: p.percentComplete,
      stepsCompleted: p.stepsCompleted,
      stepsTotal: p.stepsTotal,
      stageKeys: p.stageKeys,
    })),
    steps: progress.steps,
    overallProgressPct: progress.overallProgressPct,
    currentStepLabel: progress.currentStepLabel,
  }
}

module.exports = {
  loadUpcomingConstructionTasks,
  mapUpcomingScheduleRows,
  buildOverallTimelineFromLeads,
  buildProjectTimelineBreakdown,
  CONSTRUCTION_TIMELINE_PHASES,
}
