const parseFlexibleDate = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  const s = String(value).trim()
  if (!s) return null

  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    const year = Number(dmy[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    const d = new Date(Date.UTC(year, month - 1, day))
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
      return d
    }
    return null
  }

  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) {
    const year = Number(ymd[1])
    const month = Number(ymd[2])
    const day = Number(ymd[3])
    const d = new Date(Date.UTC(year, month - 1, day))
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
      return d
    }
    return null
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d
}

const normalizeTimeInput = (value) => {
  const s = String(value || '').trim()
  if (!s) return ''

  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (ampm) {
    let h = parseInt(ampm[1], 10)
    const m = ampm[2]
    const pm = ampm[4].toUpperCase() === 'PM'
    if (pm && h !== 12) h += 12
    if (!pm && h === 12) h = 0
    return `${String(h).padStart(2, '0')}:${m}`
  }

  const twentyFour = s.match(/^(\d{1,2}):(\d{2})$/)
  if (twentyFour) {
    const h = Number(twentyFour[1])
    const m = twentyFour[2]
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${m}`
  }

  return s
}

const addHoursToTimeString = (time24, hoursToAdd) => {
  const match = String(time24 || '').match(/^(\d{2}):(\d{2})$/)
  if (!match) return time24
  let total = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + hoursToAdd * 60
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const buildRescheduleReasonText = (body = {}) => {
  const raw = String(body.rescheduleReason || body.reason || '').trim()
  if (!raw) return { error: 'rescheduleReason is required' }
  return { reason: raw }
}

const normalizeRescheduleRequestBody = (body = {}) => {
  const b = { ...body }

  if (!b.date && b.deliveryDate) b.date = b.deliveryDate
  if (!b.date && b.newDeliveryDate) b.date = b.newDeliveryDate

  if (!b.rescheduleReason && b.reason) b.rescheduleReason = b.reason
  if (b.additionalNotes === undefined && b.notes !== undefined) {
    b.additionalNotes = b.notes
  }

  if (!b.timeWindowStart && b.startTime) b.timeWindowStart = b.startTime
  if (!b.timeWindowEnd && b.endTime) b.timeWindowEnd = b.endTime

  const tw = b.timeWindow
  if (tw && typeof tw === 'object') {
    if (!b.timeWindowStart) {
      b.timeWindowStart = tw.start || tw.startTime || tw.timeWindowStart
    }
    if (!b.timeWindowEnd) {
      b.timeWindowEnd = tw.end || tw.endTime || tw.timeWindowEnd
    }
  }

  if (b.timeWindowStart) b.timeWindowStart = normalizeTimeInput(b.timeWindowStart)
  if (b.timeWindowEnd) b.timeWindowEnd = normalizeTimeInput(b.timeWindowEnd)

  const parsedDate = parseFlexibleDate(b.date)
  if (parsedDate) b.date = parsedDate.toISOString()

  return b
}

module.exports = {
  parseFlexibleDate,
  normalizeTimeInput,
  addHoursToTimeString,
  buildRescheduleReasonText,
  normalizeRescheduleRequestBody,
}
