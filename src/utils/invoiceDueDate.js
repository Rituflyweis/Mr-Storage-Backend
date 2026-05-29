/**
 * dueDate = invoice date + daysToPay (calendar days).
 * Returns null if date or daysToPay is missing.
 */
const computeInvoiceDueDate = (date, daysToPay) => {
  if (!date || daysToPay == null || Number.isNaN(Number(daysToPay))) return null
  const days = Number(daysToPay)
  if (days < 0) return null
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000)
}

module.exports = { computeInvoiceDueDate }
