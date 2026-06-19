const ORDERS_SENT_STATUSES = new Set([
  'sent',
  'submitted',
  'comparison_processing',
  'comparison_completed',
  'comparison_failed',
  'approved',
  'rejected',
  'resubmit_requested',
])

const computeShipperFilesStats = (requests = []) => {
  const totalFiles = requests.length
  const filesReceived = requests.filter((row) => Boolean(row.submittedFileUrl)).length
  const ordersSent = requests.filter((row) => {
    return Boolean(row.sentAt) && ORDERS_SENT_STATUSES.has(row.status)
  }).length
  const revisionsSent = requests.reduce((sum, row) => sum + Number(row.resubmitCount || 0), 0)

  return {
    totalFiles,
    filesReceived,
    ordersSent,
    revisionsSent,
  }
}

module.exports = {
  ORDERS_SENT_STATUSES,
  computeShipperFilesStats,
}
