const escapeIcsText = (str = '') =>
  String(str).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n')

const toIcsDate = (date) => {
  const d = new Date(date)
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/** Builds a single-event .ics file for a scheduled delivery (all-day, since only a date + text time window is known) */
const generateDeliveryIcs = ({ uid, deliveryNumber, deliveryDate, timings, deliveryLocation, projectName, description }) => {
  const start = new Date(deliveryDate)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const dtstamp = toIcsDate(new Date())

  const toDateOnly = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')

  const summary = escapeIcsText(`Delivery ${deliveryNumber || ''} — ${projectName || ''}`.trim())
  const desc = escapeIcsText(
    [timings ? `Time window: ${timings}` : '', description || ''].filter(Boolean).join('\\n')
  )
  const location = escapeIcsText(deliveryLocation || '')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mr Storage//Customer Portal//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@mrstorage`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${toDateOnly(start)}`,
    `DTEND;VALUE=DATE:${toDateOnly(end)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${location}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

module.exports = { generateDeliveryIcs }
