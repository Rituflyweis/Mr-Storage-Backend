const MS_PER_DAY = 86400000

const startOfDay = (value) => {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  return d
}

const calendarDaysBetween = (from, to) => {
  if (!from || !to) return 0
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY)
}

/**
 * Maps a Task document to the "Project Construction Task" card shape (construction + sales panels).
 * Start date uses task `createdAt` until a dedicated start field exists on Task.
 */
const enrichConstructionTaskForCard = (task) => {
  const startDate = task.startDate || task.createdAt || null
  const estimatedEndDate = task.dueDate || null
  const completedDate = task.completedAt || null
  const now = new Date()

  let timelineBadge = { label: 'Pending', tone: 'neutral' }
  let onTimeStatus = 'pending'
  let daysLateOrEarly = 0
  let daysPastDue = 0

  if (task.status !== 'done' && estimatedEndDate && new Date(estimatedEndDate) < now) {
    daysPastDue = calendarDaysBetween(estimatedEndDate, now)
  }

  if (task.status === 'done') {
    if (estimatedEndDate && completedDate) {
      const lateDays = calendarDaysBetween(estimatedEndDate, completedDate)
      daysLateOrEarly = lateDays
      if (lateDays > 1) {
        onTimeStatus = 'late'
        timelineBadge = {
          label: `${lateDays} Days Late`,
          tone: 'success',
        }
      } else if (lateDays === 1) {
        onTimeStatus = 'late'
        timelineBadge = { label: 'Under timeline', tone: 'success' }
      } else {
        onTimeStatus = lateDays < 0 ? 'early' : 'on_time'
        timelineBadge = { label: 'Under timeline', tone: 'success' }
      }
    } else {
      onTimeStatus = 'unknown'
      timelineBadge = { label: 'Under timeline', tone: 'success' }
    }
  } else if (task.status === 'in_progress') {
    if (daysPastDue > 0) {
      onTimeStatus = 'overdue'
      timelineBadge = { label: 'Delayed', tone: 'danger' }
    } else {
      onTimeStatus = 'in_progress'
      timelineBadge = { label: 'In Progress', tone: 'info' }
    }
  } else if (daysPastDue > 0) {
    onTimeStatus = 'overdue'
    timelineBadge = { label: 'Delayed', tone: 'danger' }
  }

  let timelineStatusLine = null
  if (task.status === 'done') {
    timelineStatusLine = timelineBadge.label
  } else if (daysPastDue > 0) {
    timelineStatusLine = `${daysPastDue} Day${daysPastDue === 1 ? '' : 's'} Delayed`
  } else if (task.status === 'in_progress') {
    timelineStatusLine = 'In Progress'
  }

  return {
    ...task,
    startDate,
    estimatedEndDate,
    completedDate,
    onTimeStatus,
    daysLateOrEarly,
    daysPastDue,
    timelineStatusLine,
    canMarkComplete: task.status !== 'done',
    onTime:
      onTimeStatus === 'on_time' || onTimeStatus === 'early'
        ? true
        : onTimeStatus === 'late' || onTimeStatus === 'overdue'
          ? false
          : null,
    timelineBadge,
  }
}

const LIFECYCLE_STATUS_TO_TASK = {
  completed: 'done',
  in_progress: 'in_progress',
  pending: 'todo',
}

/**
 * Read-only card for a lifecycle step (Sales / Construction when no Task documents exist).
 */
const enrichLifecycleStepForCard = (step) => {
  const status = LIFECYCLE_STATUS_TO_TASK[step.status] || 'todo'
  const taskLike = {
    _id: step.key,
    title: step.label,
    description: step.notes || '',
    status,
    priority: 'medium',
    dueDate: step.expectedCompletion || null,
    completedAt: step.completedAt || (step.status === 'completed' ? step.date : null),
    createdAt: step.startedAt || step.date || null,
    updatedAt: step.completedAt || step.startedAt || step.date || null,
    source: 'lifecycle',
    stepKey: step.key,
    lifecycleStatus: step.status,
    assignedTo: null,
    createdBy: null,
    leadId: null,
    attachments: step.attachments || [],
  }
  return enrichConstructionTaskForCard(taskLike)
}

const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')

/** Steps in the current Inprogress timeline phase bucket (Planning, Design, …). */
const lifecycleStepsForActivePhase = (phases = [], steps = []) => {
  const active =
    phases.find((p) => p.status === 'Inprogress') ||
    [...phases].reverse().find((p) => p.status === 'Completed')
  if (!active?.stageKeys?.length) return []
  const keys = new Set(active.stageKeys)
  return steps.filter((s) => keys.has(s.key))
}

/** Plant pipeline only — same stages as Construction after release to plant (13 steps). */
const lifecycleStepsForPlantPipeline = (steps = []) => {
  const plantKeys = new Set(PLANT_LIFECYCLE_STAGES)
  return steps.filter((s) => plantKeys.has(s.key))
}

/**
 * @param {'active_phase'|'plant_pipeline'|'full'} scope
 */
const lifecycleStepsForSalesCards = (scope, phases, steps) => {
  if (scope === 'full') return steps
  if (scope === 'active_phase') return lifecycleStepsForActivePhase(phases, steps)
  return lifecycleStepsForPlantPipeline(steps)
}

const statsFromConstructionCards = (cards = []) => {
  const now = new Date()
  return {
    total: cards.length,
    todo: cards.filter((c) => c.status === 'todo').length,
    inProgress: cards.filter((c) => c.status === 'in_progress').length,
    done: cards.filter((c) => c.status === 'done').length,
    overdue: cards.filter(
      (c) =>
        c.status !== 'done' &&
        c.estimatedEndDate &&
        new Date(c.estimatedEndDate) < now
    ).length,
  }
}

module.exports = {
  enrichConstructionTaskForCard,
  enrichLifecycleStepForCard,
  lifecycleStepsForActivePhase,
  lifecycleStepsForPlantPipeline,
  lifecycleStepsForSalesCards,
  statsFromConstructionCards,
}
