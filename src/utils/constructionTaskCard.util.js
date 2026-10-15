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
  const startDate = task.createdAt || null
  const estimatedEndDate = task.dueDate || null
  const completedDate = task.completedAt || null
  const now = new Date()

  let timelineBadge = { label: 'Pending', tone: 'neutral' }

  if (task.status === 'done') {
    if (estimatedEndDate && completedDate) {
      const lateDays = calendarDaysBetween(estimatedEndDate, completedDate)
      if (lateDays > 0) {
        timelineBadge = {
          label: `${lateDays} Day${lateDays === 1 ? '' : 's'} Late`,
          tone: 'success',
        }
      } else {
        timelineBadge = { label: 'Under timeline', tone: 'success' }
      }
    } else {
      timelineBadge = { label: 'Completed', tone: 'success' }
    }
  } else if (task.status === 'in_progress') {
    if (estimatedEndDate && new Date(estimatedEndDate) < now) {
      timelineBadge = { label: 'Delayed', tone: 'danger' }
    } else {
      timelineBadge = { label: 'In Progress', tone: 'info' }
    }
  } else if (estimatedEndDate && new Date(estimatedEndDate) < now) {
    timelineBadge = { label: 'Delayed', tone: 'danger' }
  }

  return {
    ...task,
    startDate,
    estimatedEndDate,
    completedDate,
    timelineBadge,
  }
}

module.exports = {
  enrichConstructionTaskForCard,
}
