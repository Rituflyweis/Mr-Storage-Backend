const FILING_FREQUENCY_LABELS = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annual',
  varies: 'Varies',
  local_only: 'Local',
}

const { salesTaxRateLabelForTax } = require('./taxSalesRate.util')

const daysUntil = (dueDate) => {
  if (!dueDate) return null
  return Math.ceil((new Date(dueDate) - Date.now()) / 86400000)
}

const deriveUiStatus = (tax = {}) => {
  const due = tax.dueDate ? new Date(tax.dueDate) : null
  const payable = Number(tax.payable ?? tax.taxDue ?? tax.amount ?? 0)
  const isPaid = tax.status === 'paid'

  if (payable <= 0 && !isPaid) {
    return { code: 'no_tax_due', label: 'No tax due', tone: 'success' }
  }
  if (isPaid) {
    return { code: 'filed', label: 'Filed', tone: 'info' }
  }
  const left = daysUntil(due)
  if (left != null && left <= 45 && left >= 0) {
    return { code: 'due_soon', label: 'Due Soon', tone: 'warning' }
  }
  if (payable > 0) {
    return { code: 'payment_due', label: 'Payment Due', tone: 'warning' }
  }
  return { code: 'pending', label: 'Pending', tone: 'neutral' }
}

const formatFilingPeriodLabel = (tax = {}) => {
  if (tax.periodStart && tax.periodEnd) {
    const start = new Date(tax.periodStart)
    const end = new Date(tax.periodEnd)
    return `${start.toLocaleString('en-US', { month: 'short' })} ${start.getDate()} – ${end.toLocaleString('en-US', { month: 'short' })} ${end.getDate()} ${end.getFullYear()}`
  }
  if (tax.dueDate) {
    const d = new Date(tax.dueDate)
    return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`
  }
  return ''
}

const mapPendingRow = (tax = {}) => {
  const uiStatus = deriveUiStatus(tax)
  const left = daysUntil(tax.dueDate)
  return {
    _id: tax._id,
    state: tax.state,
    stateLabel: tax.state,
    salesTaxRateLabel: salesTaxRateLabelForTax(tax) || '—',
    filingPeriod: formatFilingPeriodLabel(tax),
    filingFrequency: FILING_FREQUENCY_LABELS[tax.filingFrequency] || tax.filingFrequency || 'Monthly',
    dueDate: tax.dueDate,
    daysUntilDue: left,
    daysUntilDueLabel: left == null ? '' : left >= 0 ? `In ${left} Days` : 'Overdue',
    taxDue: tax.taxDue ?? tax.amount ?? 0,
    payable: tax.payable ?? tax.taxDue ?? tax.amount ?? 0,
    status: uiStatus,
    leadId: tax.leadId?._id || tax.leadId || null,
    projectName: tax.leadId?.projectName || '',
    jobId: tax.leadId?.jobId || '',
    customerName: tax.customerId
      ? `${tax.customerId.firstName || ''} ${tax.customerId.lastName || ''}`.trim()
      : '',
  }
}

const mapHistoryRow = (tax = {}) => ({
  ...mapPendingRow(tax),
  filedDate: tax.paidAt || tax.updatedAt,
  taxPaid: tax.paidFiled ?? tax.amount ?? 0,
  method: tax.providerMethod || (tax.source === 'sync' || tax.source === 'avalara' ? 'Avalara API' : 'Manual'),
  receipt: {
    confirmationNumber: tax.confirmationNumber || '',
    receiptDate: tax.paidAt || null,
  },
  status: { code: 'filed', label: 'Filed', tone: 'success' },
})

const mapDetailModal = (tax = {}) => {
  const uiStatus = deriveUiStatus(tax)
  const taxCollected = Number(tax.taxCollected ?? 0)
  const taxPaid = Number(tax.paidFiled ?? (tax.status === 'paid' ? tax.amount : 0))
  const penalty = Number(tax.penalty ?? 0)
  const interest = Number(tax.interest ?? 0)
  const totalPayable = Math.max(0, Number(tax.payable ?? tax.taxDue ?? tax.amount ?? 0) + penalty + interest)

  return {
    _id: tax._id,
    state: tax.state,
    stateLabel: `${tax.state} Tax Details`,
    uiStatus,
    filingPeriod: formatFilingPeriodLabel(tax),
    filingPeriodRange: tax.periodStart && tax.periodEnd
      ? { start: tax.periodStart, end: tax.periodEnd }
      : null,
    filingFrequency: FILING_FREQUENCY_LABELS[tax.filingFrequency] || 'Monthly',
    filingDueDate: tax.dueDate,
    daysUntilDue: daysUntil(tax.dueDate),
    breakdown: {
      taxCollected,
      taxPaid,
      penalty,
      interest,
      totalPayable,
    },
    payNow: {
      enabled: tax.status !== 'paid' && totalPayable > 0,
      amount: totalPayable,
      currency: 'USD',
      provider: 'avalara',
      providerLabel: 'Tax Partner: Avalara CERTIFIED PARTNER',
    },
    recentActivity: Array.isArray(tax.activityLog) ? tax.activityLog : [],
    activityLog: Array.isArray(tax.activityLog) ? tax.activityLog : [],
    taxRecord: tax,
  }
}

const mapStateOverviewRow = (row = {}) => {
  const pseudo = {
    state: row._id,
    dueDate: row.nextDue,
    payable: row.payable,
    taxDue: row.payable,
    amount: row.payable,
    status: row.payable > 0 ? 'pending' : 'paid',
    taxCollected: row.taxCollected,
    taxableSales: row.taxableSales,
    paidFiled: row.paidFiled,
  }
  const uiStatus = deriveUiStatus(pseudo)
  return {
    state: row._id,
    stateLabel: row._id,
    salesTaxRateLabel: salesTaxRateLabelForTax(pseudo) || '—',
    taxCollected: row.taxCollected ?? 0,
    taxableSales: row.taxableSales ?? 0,
    paidFiled: row.paidFiled ?? 0,
    payable: row.payable ?? 0,
    dueDate: row.nextDue,
    status: uiStatus,
    taxRecordId: row.taxRecordId || null,
  }
}

const mapProjectOverviewRow = (row = {}) => {
  const pseudo = {
    dueDate: row.dueDate,
    payable: row.payable,
    taxDue: row.payable,
    amount: row.payable,
    status: row.payable > 0 ? 'pending' : 'paid',
    taxCollected: row.taxCollected,
    taxableSales: row.taxableSales,
    salesTaxRate: row.salesTaxRate,
  }
  const uiStatus = deriveUiStatus(pseudo)
  return {
    ...row,
    state: row.state || '',
    stateLabel: row.state || '',
    salesTaxRateLabel: salesTaxRateLabelForTax(pseudo) || '—',
    status: uiStatus,
    showPayTax: uiStatus.code === 'payment_due' || uiStatus.code === 'due_soon',
    taxRecordId: row.taxRecordId || null,
  }
}

module.exports = {
  mapPendingRow,
  mapHistoryRow,
  mapDetailModal,
  mapStateOverviewRow,
  mapProjectOverviewRow,
  deriveUiStatus,
  FILING_FREQUENCY_LABELS,
}
