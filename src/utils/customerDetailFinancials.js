const mongoose = require('mongoose')
const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const PaymentSchedule = require('../models/PaymentSchedule')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Resolve by Mongo `_id` or display code (`CUS-00277`). */
const resolveCustomerDoc = async (customerIdOrCode, select) => {
  if (!customerIdOrCode) return null
  const q = select
    ? Customer.findById(customerIdOrCode).select(select)
    : Customer.findById(customerIdOrCode)
  let customer = await q.lean()
  if (customer) return customer

  const code = String(customerIdOrCode).trim()
  const byCode = select
    ? Customer.findOne({ customerId: code }).select(select)
    : Customer.findOne({ customerId: code })
  return byCode.lean()
}

/**
 * Customer KPI financials for Admin/Sales detail cards.
 * Invoices are matched by customerId OR by the customer's leadIds (covers legacy
 * invoices missing customerId).
 */
const buildCustomerDetailFinancials = async (customerMongoId) => {
  const leadIds = await Lead.find({ customerId: customerMongoId }).distinct('_id')
  const leadObjectIds = leadIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))
  )

  const invoiceFilter = leadObjectIds.length
    ? {
        $or: [{ customerId: customerMongoId }, { leadId: { $in: leadObjectIds } }],
        status: { $ne: 'cancelled' },
      }
    : { customerId: customerMongoId, status: { $ne: 'cancelled' } }

  const [invoices, leads, schedules] = await Promise.all([
    Invoice.find(invoiceFilter).select('status totalAmount dueDate date leadId').lean(),
    Lead.find({ customerId: customerMongoId })
      .select('quoteValue jobId projectName lifecycleStatus')
      .lean(),
    leadObjectIds.length
      ? PaymentSchedule.find({ leadId: { $in: leadObjectIds } })
          .select('stages leadId')
          .lean()
      : [],
  ])

  // Dedupe if both customerId and leadId matched the same invoice
  const seen = new Set()
  const uniqueInvoices = []
  for (const inv of invoices) {
    const key = String(inv._id)
    if (seen.has(key)) continue
    seen.add(key)
    uniqueInvoices.push(inv)
  }

  const now = new Date()
  let totalPaid = 0
  let pendingPayment = 0
  let overdueAmount = 0
  let totalInvoiced = 0

  for (const inv of uniqueInvoices) {
    const amt = Number(inv.totalAmount) || 0
    totalInvoiced += amt
    if (inv.status === 'paid') {
      totalPaid += amt
      continue
    }
    const due = inv.dueDate ? new Date(inv.dueDate) : inv.date ? new Date(inv.date) : null
    const isOverdue =
      inv.status === 'overdue' || (due && !Number.isNaN(due.getTime()) && due < now)
    if (isOverdue) overdueAmount += amt
    // Include sent + overdue + draft (awaiting send) so KPIs aren't stuck at $0 when
    // work is quoted/invoiced but not yet in a narrow "sent" state.
    if (['sent', 'overdue', 'draft'].includes(inv.status) || isOverdue) {
      pendingPayment += amt
    }
  }

  const totalQuotedValue = leads.reduce((s, l) => s + (Number(l.quoteValue) || 0), 0)

  // No invoice rows yet: prefer unpaid payment-schedule stages, else remaining quote value.
  if (pendingPayment === 0 && totalPaid === 0) {
    let schedulePending = 0
    for (const sched of schedules) {
      for (const stage of sched.stages || []) {
        if (stage.status === 'paid') continue
        schedulePending += Number(stage.amount) || 0
      }
    }
    pendingPayment = schedulePending > 0 ? schedulePending : Math.max(0, totalQuotedValue)
  } else if (pendingPayment === 0 && totalQuotedValue > totalPaid) {
    // Partially collected vs project quote
    pendingPayment = Math.max(0, totalQuotedValue - totalPaid)
  }

  // Revenue card: cash collected when present; otherwise quoted project value (sales parity).
  const revenueGenerated = totalPaid > 0 ? totalPaid : totalQuotedValue

  const financials = {
    totalPaid: round2(totalPaid),
    pendingPayment: round2(pendingPayment),
    totalInvoices: uniqueInvoices.length,
    revenueGenerated: round2(revenueGenerated),
    totalInvoiced: round2(totalInvoiced),
    totalQuotedValue: round2(totalQuotedValue),
    overdueAmount: round2(overdueAmount),
  }

  return {
    financials,
    // Top-level / alternate shapes some Admin FE builds bind to
    kpis: { ...financials },
    stats: { ...financials },
    customerRevenue: {
      totalQuotedValue: financials.totalQuotedValue,
      totalInvoiced: financials.totalInvoiced,
      totalReceived: financials.totalPaid,
      outstandingAmount: financials.pendingPayment,
      overdue: financials.overdueAmount,
    },
    totalPaid: financials.totalPaid,
    pendingPayment: financials.pendingPayment,
    totalInvoices: financials.totalInvoices,
    revenueGenerated: financials.revenueGenerated,
  }
}

module.exports = {
  resolveCustomerDoc,
  buildCustomerDetailFinancials,
}
