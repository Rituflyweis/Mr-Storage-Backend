const CATEGORY_LABELS = {
  vendor_payment: 'Vendor Payment',
  shipper_payment: 'Shipper Payment',
  equipment: 'Equipment',
  other_expenses: 'Other Expenses',
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const initialsFromName = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

const resolveApprovalStatusLabel = (a) => {
  const status = a?.status
  if (status === 'approved' && a?.paidAt) return 'Paid'
  if (status === 'under_review') return 'Under Review'
  if (status === 'pending') return 'Pending'
  if (status === 'disputed') return 'Disputed'
  if (status === 'rejected') return 'Rejected'
  if (status === 'approved') return 'Approved'
  return status || ''
}

const resolveApprovalWorkflowStage = (a) => {
  if (a?.status === 'disputed') return 'disputed'
  if (a?.status === 'approved' && a?.paidAt) return 'paid'
  if (a?.status === 'approved') return 'approved'
  return a?.status || 'pending'
}

const resolveCategoryLabel = (category) => CATEGORY_LABELS[category] || category || ''

const paymentApprovalPriority = (dueDate) => {
  if (!dueDate) return 'normal'
  const days = Math.ceil((new Date(dueDate) - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) return 'overdue'
  if (days <= 7) return 'high'
  if (days <= 14) return 'medium'
  return 'normal'
}

const mapRemarksForUi = (remarks = [], subtitleFallback = '') => {
  const sorted = [...remarks].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  )
  return sorted.map((r, index) => {
    const author = r.author && typeof r.author === 'object' ? r.author : null
    const authorName = author?.name || 'User'
    return {
      id: r._id,
      authorName,
      authorInitials: initialsFromName(authorName),
      subtitle: subtitleFallback || author?.email || '',
      text: r.text,
      createdAt: r.createdAt,
      isLatest: index === 0,
    }
  })
}

const mapAttachmentsForUi = (attachments = []) =>
  attachments.map((a, index) => ({
    index,
    name: a.name || `Attachment ${index + 1}`,
    url: a.url,
    fileSize: a.fileSize || 0,
    uploadedAt: a.createdAt || null,
    uploadedBy: a.uploadedBy && typeof a.uploadedBy === 'object'
      ? { userId: a.uploadedBy._id, name: a.uploadedBy.name }
      : null,
  }))

const mapHistoryForUi = (approval, activityLog = []) => {
  const entries = [...(activityLog || [])].sort(
    (a, b) => new Date(b.at || 0) - new Date(a.at || 0)
  )
  return entries.map((e) => ({
    at: e.at,
    type: e.type,
    label: e.label,
    userName: e.user && typeof e.user === 'object' ? e.user.name : '',
  }))
}

const buildSyntheticHistoryIfEmpty = (approval) => {
  const items = []
  if (approval.createdAt) {
    items.push({
      at: approval.createdAt,
      type: 'created',
      label: 'Payment approval requested',
      user: approval.requestedBy,
    })
  }
  if (approval.reviewedAt) {
    items.push({
      at: approval.reviewedAt,
      type: 'review',
      label: `Marked ${approval.status}`,
      user: approval.reviewedBy,
    })
  }
  if (approval.paidAt) {
    items.push({
      at: approval.paidAt,
      type: 'paid',
      label: 'Payment recorded',
      user: approval.reviewedBy,
    })
  }
  return items
}

module.exports = {
  CATEGORY_LABELS,
  round2,
  initialsFromName,
  resolveApprovalStatusLabel,
  resolveApprovalWorkflowStage,
  resolveCategoryLabel,
  paymentApprovalPriority,
  mapRemarksForUi,
  mapAttachmentsForUi,
  mapHistoryForUi,
  buildSyntheticHistoryIfEmpty,
}
