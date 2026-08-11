const { isInvoiceOverdue } = require('./invoiceScope')

const computeProjectInvoiceStats = (invoices, now = new Date()) => {
  let totalPaymentsReceived = 0
  let pendingAmount = 0
  let overdueAmount = 0

  for (const inv of invoices) {
    if (inv.status === 'cancelled') continue
    const amt = inv.totalAmount || 0
    if (inv.status === 'paid') {
      totalPaymentsReceived += amt
    } else if (isInvoiceOverdue(inv, now)) {
      overdueAmount += amt
    } else if (['draft', 'sent'].includes(inv.status)) {
      pendingAmount += amt
    }
  }

  const totalOutstanding = pendingAmount + overdueAmount
  const paymentCompletion = totalPaymentsReceived + totalOutstanding > 0
    ? Math.round((totalPaymentsReceived / (totalPaymentsReceived + totalOutstanding)) * 1000) / 10
    : 0

  return {
    totalPaymentsReceived,
    paymentCompletion,
    pendingAmount,
    overdueAmount,
  }
}

const mapInvoiceDisplayStatus = (inv, now = new Date()) => {
  if (inv.status === 'paid') return 'Received'
  if (isInvoiceOverdue(inv, now)) return 'Overdue'
  if (inv.status === 'sent') return 'Pending'
  if (inv.status === 'draft') return 'Draft'
  if (inv.status === 'cancelled') return 'Cancelled'
  return inv.status
}

const mapProjectInvoiceRow = (inv, now = new Date()) => {
  const date = inv.status === 'paid' && inv.paidAt
    ? inv.paidAt
    : inv.dueDate || inv.date || inv.createdAt

  return {
    invoiceId: inv._id,
    invoiceNumber: inv.invoiceNumber || '',
    date,
    amount: inv.totalAmount || 0,
    status: mapInvoiceDisplayStatus(inv, now),
    invoiceStatus: inv.status,
    subtotal: inv.subtotal ?? 0,
    markupTotal: inv.markupTotal ?? 0,
    tax: inv.tax ?? 0,
    discount: inv.discount ?? 0,
    depositAmount: inv.depositAmount ?? 0,
    totalAmount: inv.totalAmount ?? 0,
    lineItems: inv.lineItems || [],
    description: inv.description || '',
    daysToPay: inv.daysToPay ?? null,
    dueDate: inv.dueDate || null,
    poNumber: inv.poNumber || '',
    invoice: inv,
  }
}

module.exports = {
  computeProjectInvoiceStats,
  mapInvoiceDisplayStatus,
  mapProjectInvoiceRow,
}
