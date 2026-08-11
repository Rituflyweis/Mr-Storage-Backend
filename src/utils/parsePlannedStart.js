const MONTH_INDEX = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
}

const MONTH_PATTERN = Object.keys(MONTH_INDEX).join('|')

const aiAskedAboutTimeline = (text = '') => {
  const t = String(text).toLowerCase()
  return (
    /\bwhen\b.*\bstart\b/.test(t) ||
    /\bplanning to start\b/.test(t) ||
    /\btimeline\b/.test(t) ||
    /\bwhen would you like\b/.test(t) ||
    /\bstart date\b/.test(t) ||
    /\bwhen do you want\b/.test(t) ||
    /\bhow soon\b/.test(t)
  )
}

const findMonthIndex = (text = '') => {
  const t = String(text).toLowerCase()
  const match = t.match(new RegExp(`\\b(${MONTH_PATTERN})\\b`, 'i'))
  if (!match) return null
  return MONTH_INDEX[match[1].toLowerCase()] ?? null
}

const startOfMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex, 1))

/** Normalize a customer timeline reply into the first day of the target month (UTC). */
const parsePlannedStartFromText = (content, precedingAiText = '', referenceDate = new Date()) => {
  const text = String(content || '').trim()
  if (!text || !aiAskedAboutTimeline(precedingAiText)) return null

  const currentYear = referenceDate.getFullYear()

  const monthWithYear = text.match(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`, 'i')
  )
  if (monthWithYear) {
    const monthIndex = MONTH_INDEX[monthWithYear[1].toLowerCase()]
    const year = parseInt(monthWithYear[2], 10)
    if (monthIndex != null && year >= 2020 && year <= 2100) {
      return startOfMonth(year, monthIndex)
    }
  }

  const numericMonthYear = text.match(/\b(\d{1,2})[/-](\d{4})\b/)
  if (numericMonthYear) {
    const monthIndex = parseInt(numericMonthYear[1], 10) - 1
    const year = parseInt(numericMonthYear[2], 10)
    if (monthIndex >= 0 && monthIndex <= 11 && year >= 2020 && year <= 2100) {
      return startOfMonth(year, monthIndex)
    }
  }

  if (/^\d{4}$/.test(text)) {
    const year = parseInt(text, 10)
    if (year >= 2020 && year <= 2100) return startOfMonth(year, 0)
  }

  const monthIndex = findMonthIndex(text)
  if (monthIndex != null && !/\d{4}/.test(text)) {
    return startOfMonth(currentYear, monthIndex)
  }

  return null
}

const getPrecedingAiMessage = (messages, customerIndex) => {
  for (let j = customerIndex - 1; j >= 0; j -= 1) {
    if (messages[j]?.senderType === 'ai') return messages[j]
  }
  return null
}

/** Most recent customer timeline answer when Alex asked about start date. */
const extractPlannedStartFromMessages = (messages = [], referenceDate = new Date()) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.senderType !== 'customer') continue
    const precedingAi = getPrecedingAiMessage(messages, i)
    const parsed = parsePlannedStartFromText(m.content, precedingAi?.content || '', referenceDate)
    if (parsed) return parsed
  }
  return null
}

const formatPlannedStartLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

module.exports = {
  aiAskedAboutTimeline,
  parsePlannedStartFromText,
  extractPlannedStartFromMessages,
  formatPlannedStartLabel,
}
