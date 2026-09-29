const { allocateSequentialId } = require('./allocateSequentialId')
const { isValidTimeZone } = require('./timezoneDate')
const { PROJECT_ID_TIMEZONE } = require('../config/env')

const PROJECT_ID_SEQUENCE_PAD = 3
const PROJECT_ID_FALLBACK_TIMEZONE = 'America/New_York'

const resolveProjectIdTimeZone = () =>
  isValidTimeZone(PROJECT_ID_TIMEZONE) ? PROJECT_ID_TIMEZONE : PROJECT_ID_FALLBACK_TIMEZONE

/** Calendar year of `date` in the business timezone (not the server's own clock zone). */
const getProjectIdYear = (date = new Date(), timeZone = resolveProjectIdTimeZone()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date))

/** Year-based project id: YYYY + sequence that restarts each year (2026001, 2026002, …). */
const formatYearJobId = (year, n) => `${year}${String(n).padStart(PROJECT_ID_SEQUENCE_PAD, '0')}`

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
