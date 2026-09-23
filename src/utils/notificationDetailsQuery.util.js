const normalizeChannelFilter = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null
  const s = String(raw).toLowerCase()
  if (s.includes('email')) return 'email'
  if (s.includes('sms')) return 'sms'
  return s
}

const normalizeStatusFilter = (query = {}) => {
  const raw = query.status ?? query.deliveryStatus ?? query.notificationStatus
  if (raw === undefined || raw === null || raw === '') return null
  return String(raw).toLowerCase().trim()
}

const normalizeRecipientTypeFilter = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null
  const s = String(raw).toLowerCase().trim()
  if (s.includes('internal')) return 'internal'
  if (s.includes('customer')) return 'customer'
  return s
}

const sentAtInRange = (sentAt, startDate, endDate) => {
  if (!sentAt) return true
  const t = new Date(sentAt).getTime()
  if (Number.isNaN(t)) return true
  if (startDate) {
    const start = new Date(startDate)
    if (!Number.isNaN(start.getTime()) && t < start.getTime()) return false
  }
  if (endDate) {
    const end = new Date(endDate)
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999)
      if (t > end.getTime()) return false
    }
  }
  return true
}

const rowMatchesStatusFilter = (row, statusFilter) => {
  if (!statusFilter) return true
  const rollup = String(row.deliveryStatus || '').toLowerCase()
  const raw = String(row.rawDeliveryStatus || '').toLowerCase()
  const label = String(row.deliveryStatusLabel || '').toLowerCase()

  if (statusFilter === 'scheduled') {
    return raw === 'scheduled' || label.includes('scheduled')
      || row.notificationType === 'Delivery Scheduled'
  }
  if (statusFilter === 'rescheduled') {
    return row.hasReschedule || raw === 'rescheduled' || label.includes('rescheduled')
  }
  if (['sent', 'pending', 'delivered', 'failed'].includes(statusFilter)) {
    return rollup === statusFilter || raw === statusFilter || label.includes(statusFilter)
  }
  return rollup.includes(statusFilter) || raw.includes(statusFilter) || label.includes(statusFilter)
}

const filterNotificationRows = (rows, query = {}) => {
  const statusFilter = normalizeStatusFilter(query)
  const channelFilter = normalizeChannelFilter(query.channel ?? query.channelType)
  const recipientFilter = normalizeRecipientTypeFilter(query.recipientType)
  const search = String(query.search || '').trim().toLowerCase()
  const { startDate, endDate } = query

  return rows.filter((row) => {
    if (!sentAtInRange(row.sentAt, startDate, endDate)) return false
    if (!rowMatchesStatusFilter(row, statusFilter)) return false

    if (channelFilter) {
      const ch = String(row.channel || '').toLowerCase()
      if (!ch.includes(channelFilter)) return false
    }

    if (recipientFilter) {
      const rt = String(row.recipientType || '').toLowerCase()
      if (recipientFilter === 'customer' && !rt.includes('customer')) return false
      if (recipientFilter === 'internal' && !rt.includes('internal')) return false
    }

    if (search) {
      const haystack = [
        row.notificationId,
        row.notificationType,
        row.channel,
        row.deliveryNumber,
        row.project,
        row.recipient,
        row.recipientContact,
        row.recipientType,
        row.deliveryStatus,
        row.deliveryStatusLabel,
        row.materialType,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(search)) return false
    }

    return true
  })
}

const formatDeliveryStatusLabel = (delivery) => {
  const status = String(delivery?.status || '').trim()
  if (!status) return ''
  if (status === 'rescheduled') return 'Rescheduled'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

module.exports = {
  normalizeChannelFilter,
  normalizeStatusFilter,
  filterNotificationRows,
  formatDeliveryStatusLabel,
}
