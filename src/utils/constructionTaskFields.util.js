const parseOptionalDate = (value) => {
  if (value === null || value === undefined || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** dueDate / estimatedEndDate, startDate, completedAt / completedDate from request body. */
const parseTaskScheduleFromBody = (body = {}) => {
  const dueRaw = body.dueDate !== undefined ? body.dueDate : body.estimatedEndDate
  const dueDate = dueRaw !== undefined ? parseOptionalDate(dueRaw) : undefined
  const startDate = body.startDate !== undefined ? parseOptionalDate(body.startDate) : undefined
  const completedRaw =
    body.completedAt !== undefined ? body.completedAt : body.completedDate
  const completedAt = completedRaw !== undefined ? parseOptionalDate(completedRaw) : undefined
  return { dueDate, startDate, completedAt }
}

const applyTaskStatusAndCompletion = (task, status, completedAtFromBody) => {
  if (status === undefined && completedAtFromBody === undefined) return

  if (status !== undefined) {
    task.status = status
    if (status === 'done') {
      if (completedAtFromBody instanceof Date) task.completedAt = completedAtFromBody
      else if (!task.completedAt) task.completedAt = new Date()
    } else {
      task.completedAt = null
    }
  } else if (completedAtFromBody instanceof Date) {
    task.completedAt = completedAtFromBody
    if (task.status !== 'done') task.status = 'done'
  } else if (completedAtFromBody === null) {
    task.completedAt = null
  }
}

module.exports = {
  parseTaskScheduleFromBody,
  applyTaskStatusAndCompletion,
}
