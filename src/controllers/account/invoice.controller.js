const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const PaymentSchedule = require('../../models/PaymentSchedule')
const Customer = require('../../models/Customer')
const mailer = require('../../services/email/mailer')
const auditService = require('../../services/audit.service')
const { buildDateFilter } = require('../../utils/dateRange')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

const computeDueDate = (inv) => {
  if (!inv.daysToPay || !inv.date) return null
  return new Date(new Date(inv.date).getTime() + inv.daysToPay * 24 * 60 * 60 * 1000)
}

exports.getInvoices = asyncHandler(async (req, res) => {
  const { status } = req.query
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const invoiceFilter = { ...dateFilter }
  if (status) invoiceFilter.status = status

  const [invoices, leads] = await Promise.all([
    Invoice.find(invoiceFilter)
      .populate('createdBy', 'name email')
      .populate('paidBy', 'name email')
      .sort({ createdAt: -1 })
      .lean(),
    Lead.find().select('buildingType location lifecycleStatus customerId assignedSales').lean(),
  ])

  const leadMap = Object.fromEntries(leads.map(l => [String(l._id), l]))

  // Group by leadId
  const grouped = {}
  for (const inv of invoices) {
    const key = String(inv.leadId)
    if (!grouped[key]) grouped[key] = { lead: leadMap[key] || { _id: inv.leadId }, invoices: [] }
    grouped[key].invoices.push(inv)
  }

  const projects = Object.values(grouped)

  return success(res, { projects })
})

exports.markAsPaid = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (invoice.status === 'paid') return badRequest(res, 'Invoice already paid')
  if (['draft', 'cancelled'].includes(invoice.status)) {
    return badRequest(res, 'Cannot mark a draft or cancelled invoice as paid')
  }

  invoice.status = 'paid'
  invoice.paidAt = new Date()
  invoice.paidBy = req.user._id
  await invoice.save()

  await auditService.log({
    type:        'invoice',
    action:      AUDIT_ACTIONS.INVOICE_PAID,
    leadId:      invoice.leadId,
    customerId:  invoice.customerId,
    performedBy: req.user._id,
    metadata:    { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
  })

  return success(res, { invoice }, 'Invoice marked as paid')
})

exports.getAnalytics = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const invoices = await Invoice.find({ status: 'paid', ...dateFilter })
    .select('totalAmount sentAt paidAt daysToPay')
    .lean()

  const totalInvoices = invoices.length
  const totalRevenue  = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const avgInvoiceValue = totalInvoices ? Math.round(totalRevenue / totalInvoices) : 0

  let totalDays = 0, onTimeCount = 0, lateCount = 0

  for (const inv of invoices) {
    if (inv.sentAt && inv.paidAt) {
      const days = Math.ceil((new Date(inv.paidAt) - new Date(inv.sentAt)) / (1000 * 60 * 60 * 24))
      totalDays += days
      const allowed = inv.daysToPay || Infinity
      if (days <= allowed) onTimeCount++
      else                 lateCount++
    }
  }

  const avgDaysToPay = totalInvoices ? Math.round(totalDays / totalInvoices) : 0
  const judged       = onTimeCount + lateCount
  const onTimePct    = judged ? Math.round((onTimeCount / judged) * 100) : 0

  return success(res, { avgInvoiceValue, avgDaysToPay, onTimeCount, lateCount, onTimePct, totalInvoices, totalRevenue })
})

exports.getProjectBreakdown = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const [lead, invoices] = await Promise.all([
    Lead.findById(leadId)
      .populate('customerId')
      .populate('assignedSales', 'name email')
      .lean(),
    Invoice.find({ leadId }).sort({ createdAt: -1 }).lean(),
  ])

  if (!lead) return notFound(res, 'Lead not found')

  const schedules = await PaymentSchedule.find({ leadId }).lean()
  const scheduleMap = Object.fromEntries(schedules.map(s => [String(s.invoiceId), s]))

  const invoicesWithSchedule = invoices.map(inv => ({
    ...inv,
    paymentSchedule: scheduleMap[String(inv._id)]
      ? { _id: scheduleMap[String(inv._id)]._id, payments: scheduleMap[String(inv._id)].payments }
      : null,
  }))

  const totalBilled  = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalPaid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const totalPending = totalBilled - totalPaid

  return success(res, { lead, invoices: invoicesWithSchedule, totalBilled, totalPaid, totalPending })
})
