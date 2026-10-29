const { allocateSequentialId } = require('./allocateSequentialId')
const { isValidTimeZone } = require('./timezoneDate')
const { PROJECT_ID_TIMEZONE } = require('../config/env')

const PROJECT_ID_SEQUENCE_PAD = 3
const PROJECT_ID_FALLBACK_TIMEZONE = 'America/New_York'

/** YYYY + at least 3-digit sequence, e.g. 2026001, 2026240 */
const YEAR_JOB_ID_REGEX = /^(\d{4})(\d{3,})$/

const resolveProjectIdTimeZone = () =>
  isValidTimeZone(PROJECT_ID_TIMEZONE) ? PROJECT_ID_TIMEZONE : PROJECT_ID_FALLBACK_TIMEZONE

/** Calendar year of `date` in the business timezone (not the server's own clock zone). */
const getProjectIdYear = (date = new Date(), timeZone = resolveProjectIdTimeZone()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date))

/** Year-based project id: YYYY + sequence that restarts each year (2026001, 2026002, …). */
const formatYearJobId = (year, n) => `${year}${String(n).padStart(PROJECT_ID_SEQUENCE_PAD, '0')}`

const isYearFormatJobId = (value) => {
  const s = String(value || '').trim()
  if (!YEAR_JOB_ID_REGEX.test(s)) return false
  const year = Number(s.slice(0, 4))
  return year >= 2000 && year <= 2100
}

const generateJobId = async (date = new Date()) => {
  const Lead = require('../models/Lead')
  const year = getProjectIdYear(date)
  const yearPattern = new RegExp(`^${year}(\\d{${PROJECT_ID_SEQUENCE_PAD},})$`)
  return allocateSequentialId({
    model: Lead,
    field: 'jobId',
    parsePattern: yearPattern,
    format: (n) => formatYearJobId(year, n),
    filter: { jobId: { $regex: yearPattern } },
    includeDeleted: true,
  })
}

module.exports = generateJobId
module.exports.formatYearJobId = formatYearJobId
module.exports.getProjectIdYear = getProjectIdYear
module.exports.isYearFormatJobId = isYearFormatJobId
module.exports.YEAR_JOB_ID_REGEX = YEAR_JOB_ID_REGEX
