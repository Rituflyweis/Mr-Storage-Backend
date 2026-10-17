const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const Expense = require('../models/Expense')
const ShipperRequest = require('../models/ShipperRequest')
const VendorQuoteLine = require('../models/VendorQuoteLine')
const FreightBid = require('../models/FreightBid')
const Delivery = require('../models/Delivery')
const PaymentApproval = require('../models/PaymentApproval')
const generateInvoiceNumber = require('../utils/generateInvoiceNumber')
const { buildDateFilter } = require('../utils/dateRange')
const { isInvoiceOverdue } = require('../utils/invoiceScope')
const { resolveLeadByProjectRef } = require('../utils/projectRef')
const {
  aggregateProjectExpensesForLead,
  round2,
} = require('../utils/projectExpenseAggregate.util')

const CUSTOMER_INVOICE_MATCH = {
  invoiceType: { $nin: ['vendor', 'freight_carrier'] },
  status: { $ne: 'cancelled' },
}

const INCOME_TYPES = {
  milestone: 'Milestone Income',
  advance: 'Advance Received',
  variation: 'Variation Order',
  claims: 'Claims & Adjustments',
  other: 'Other Income',
}

const PENDING_SHIPPER_STATUSES = [
  'submitted',
  'comparison_completed',
  'comparison_processing',
  'resubmit_requested',
]

const paginate = (query) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10))
  return { page, limit, skip: (page - 1) * limit }
}

const resolveLead = async (projectRef) => {
  const lead = await resolveLeadByProjectRef(projectRef)
  if (!lead || lead.isDeleted) return null
  return Lead.findById(lead._id)
    .select(
      'projectName jobId quoteValue location lifecycleStatus createdAt endDate customerId isArchived isTerminated'
    )
    .lean()
}

const lineAmount = (line) => {
  if (line.amount != null && !Number.isNaN(Number(line.amount))) return Number(line.amount)
  const qty = line.qty ?? line.pieceQty
  if (qty != null && line.unitPrice != null) return Number(qty) * Number(line.unitPrice)
  return 0
}

const loadLineTotalsByRequestId = async (requestIds) => {
  const map = new Map()
  if (!requestIds.length) return map
  const lines = await VendorQuoteLine.find({ shipperRequestId: { $in: requestIds } })
    .select('shipperRequestId amount qty pieceQty unitPrice')
    .lean()
  for (const line of lines) {
    const key = String(line.shipperRequestId)
    map.set(key, (map.get(key) || 0) + lineAmount(line))
  }
  return map
}

const requestQuoteAmount = (sr, lineTotalsByRequestId) => {
  if (sr.quoteValue != null && !Number.isNaN(Number(sr.quoteValue))) return Number(sr.quoteValue)
  return lineTotalsByRequestId.get(String(sr._id)) || 0
}

const deriveIncomeType = (inv) => {
  const key = inv.serviceCategory || ''
  if (key && INCOME_TYPES[key]) return { key, label: INCOME_TYPES[key] }
  if (inv.paymentScheduleStageId) return { key: 'milestone', label: INCOME_TYPES.milestone }
  const proofNotes = inv.paymentProof?.notes || ''
  const text = `${inv.description || ''} ${proofNotes}`.toLowerCase()
  if (text.includes('advance')) return { key: 'advance', label: INCOME_TYPES.advance }
  if (text.includes('variation')) return { key: 'variation', label: INCOME_TYPES.variation }
  if (text.includes('claim')) return { key: 'claims', label: INCOME_TYPES.claims }
  return { key: 'milestone', label: INCOME_TYPES.milestone }
}

const invoiceDisplayStatus = (inv, now = new Date()) => {
  if (inv.status === 'paid') return 'Received'
  if (isInvoiceOverdue(inv, now)) return 'Overdue'
  if (inv.status === 'draft') return 'Draft'
  return 'Pending'
}

const classifyIncomeTab = (inv, now = new Date()) => {
  if (inv.status === 'paid') return 'received'
  if (isInvoiceOverdue(inv, now)) return 'overdue'
  return 'pending'
}

const sumInvoices = (invoices, predicate) =>
  round2(invoices.filter(predicate).reduce((s, inv) => s + (inv.totalAmount || 0), 0))

const buildProjectHeader = (lead) => ({
  leadId: lead._id,
  projectName: lead.projectName || '',
  projectId: lead.jobId || '',
  status: lead.lifecycleStatus || '',
  location: lead.location || '',
  quoteValue: round2(lead.quoteValue || 0),
  startDate: lead.createdAt || null,
  endDate: lead.endDate || null,
})

const buildIncomeSidebar = (allInvoices, quoteValue, now) => {
  const billedToDate = sumInvoices(allInvoices, () => true)
  const receivedIncome = sumInvoices(allInvoices, (inv) => inv.status === 'paid')
  const overdueIncome = sumInvoices(
    allInvoices,
    (inv) => inv.status !== 'paid' && isInvoiceOverdue(inv, now)
  )
  const pendingIncome = sumInvoices(
    allInvoices,
    (inv) => inv.status !== 'paid' && !isInvoiceOverdue(inv, now)
  )
  const totalIncome = billedToDate
  const contractValue = round2(quoteValue || 0)
  const retentionAmount = 0
  const retentionReleased = 0
  const balanceBase = contractValue > 0 ? contractValue : billedToDate
  const balanceToBeReceived = round2(Math.max(0, balanceBase - receivedIncome))

  return {
    totalContractValue: contractValue,
    billedToDate,
    totalIncome,
    receivedIncome,
    pendingIncome,
    overdueIncome,
    retentionAmount,
    retentionReleased,
    balanceToBeReceived,
  }
}

const mapIncomeTransaction = (inv, now) => {
  const incomeType = deriveIncomeType(inv)
  return {
    transactionId: inv._id,
    incomeType: incomeType.key,
    incomeTypeLabel: incomeType.label,
    date: inv.status === 'paid' && inv.paidAt ? inv.paidAt : inv.date || inv.createdAt,
    description: inv.description || '',
    invoiceNumber: inv.invoiceNumber || '',
    amount: round2(inv.totalAmount || 0),
    status: invoiceDisplayStatus(inv, now),
    invoiceStatus: inv.status,
    tab: classifyIncomeTab(inv, now),
  }
}

exports.getProjectWiseIncomeDetail = async (projectRef, query = {}) => {
  const lead = await resolveLead(projectRef)
  if (!lead) return { error: 'Project not found', code: 404 }

  const invoiceDateFilter = buildDateFilter(query, 'date')
  const now = new Date()
  const { page, limit, skip } = paginate(query)

  const [allInvoices, filteredInvoices] = await Promise.all([
    Invoice.find({ leadId: lead._id, ...CUSTOMER_INVOICE_MATCH })
      .select(
        'totalAmount status dueDate date daysToPay paidAt invoiceNumber description paymentScheduleStageId serviceCategory paymentProof createdAt lineItems subtotal'
      )
      .lean(),
    Invoice.find({ leadId: lead._id, ...CUSTOMER_INVOICE_MATCH, ...invoiceDateFilter })
      .select(
        'totalAmount status dueDate date daysToPay paidAt invoiceNumber description paymentScheduleStageId serviceCategory paymentProof createdAt lineItems subtotal'
      )
      .sort({ date: -1, createdAt: -1 })
      .lean(),
  ])

  const summaryFiltered = {
    totalIncome: sumInvoices(filteredInvoices, () => true),
    receivedIncome: sumInvoices(filteredInvoices, (inv) => inv.status === 'paid'),
    pendingIncome: sumInvoices(
      filteredInvoices,
      (inv) => inv.status !== 'paid' && !isInvoiceOverdue(inv, now)
    ),
    overdueIncome: sumInvoices(
      filteredInvoices,
      (inv) => inv.status !== 'paid' && isInvoiceOverdue(inv, now)
    ),
  }

  let rows = filteredInvoices.map((inv) => mapIncomeTransaction(inv, now))
  const tab = String(query.tab || 'received').toLowerCase()
  if (tab !== 'all') {
    rows = rows.filter((r) => r.tab === tab)
  }
  if (query.search?.trim()) {
    const re = new RegExp(query.search.trim(), 'i')
    rows = rows.filter(
      (r) => re.test(r.invoiceNumber) || re.test(r.description) || re.test(r.incomeTypeLabel)
    )
  }

  const total = rows.length
  const transactions = rows.slice(skip, skip + limit)

  return {
    project: buildProjectHeader(lead),
    summary: summaryFiltered,
    incomeSummarySidebar: buildIncomeSidebar(allInvoices, lead.quoteValue, now),
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
    incomeTypeOptions: Object.entries(INCOME_TYPES).map(([key, label]) => ({ key, label })),
  }
}

exports.getProjectWiseIncomeTransaction = async (projectRef, transactionId) => {
  const lead = await resolveLead(projectRef)
  if (!lead) return { error: 'Project not found', code: 404 }

  const inv = await Invoice.findOne({
    _id: transactionId,
    leadId: lead._id,
    ...CUSTOMER_INVOICE_MATCH,
  }).lean()
  if (!inv) return { error: 'Income transaction not found', code: 404 }

  const now = new Date()
  const incomeType = deriveIncomeType(inv)
  return {
    transaction: {
      ...mapIncomeTransaction(inv, now),
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      lineItems: inv.lineItems || [],
      subtotal: inv.subtotal,
      totalAmount: inv.totalAmount,
    },
    incomeTypeLabel: incomeType.label,
    project: buildProjectHeader(lead),
  }
}

exports.createProjectReceivedIncome = async (projectRef, body, userId) => {
  const lead = await resolveLead(projectRef)
  if (!lead) return { error: 'Project not found', code: 404 }
  if (!lead.customerId) return { error: 'Project has no customer; cannot record customer income', code: 400 }

  const incomeTypeKey = body.incomeType && INCOME_TYPES[body.incomeType] ? body.incomeType : 'milestone'
  const amount = round2(Number(body.amount))
  if (!amount || amount <= 0) return { error: 'amount must be a positive number', code: 400 }

  const paymentStatus = String(body.status || 'received').toLowerCase()
  const markReceived = paymentStatus === 'received' || paymentStatus === 'paid'
  const recordDate = body.date ? new Date(body.date) : new Date()

  let invoiceNumber = body.invoiceNumber?.trim()
  if (invoiceNumber) {
    const existing = await Invoice.findOne({ invoiceNumber }).lean()
    if (existing) {
      if (String(existing.leadId) !== String(lead._id)) {
        return { error: 'invoiceNumber already used on another project', code: 409 }
      }
      if (markReceived && existing.status !== 'paid') {
        await Invoice.updateOne(
          { _id: existing._id },
          { $set: { status: 'paid', paidAt: recordDate, paidBy: userId } }
        )
      }
      const updated = await Invoice.findById(existing._id).lean()
      return { invoice: updated, transaction: mapIncomeTransaction(updated, new Date()) }
    }
  } else {
    invoiceNumber = await generateInvoiceNumber()
  }

  const invoice = await Invoice.create({
    leadId: lead._id,
    customerId: lead.customerId,
    invoiceType: 'customer',
    category: 'service',
    createdBy: userId,
    invoiceNumber,
    description: body.description?.trim() || INCOME_TYPES[incomeTypeKey],
    date: recordDate,
    dueDate: recordDate,
    daysToPay: 0,
    lineItems: [
      {
        description: body.description?.trim() || INCOME_TYPES[incomeTypeKey],
        quantity: 1,
        rate: amount,
        effectiveRate: amount,
        total: amount,
      },
    ],
    subtotal: amount,
    totalAmount: amount,
    status: markReceived ? 'paid' : 'sent',
    paidAt: markReceived ? recordDate : null,
    paidBy: markReceived ? userId : null,
    serviceCategory: incomeTypeKey,
  })

  return {
    invoice: invoice.toObject(),
    transaction: mapIncomeTransaction(invoice.toObject(), new Date()),
  }
}

const expenseCategoryLabel = (category) => {
  const c = String(category || '').toLowerCase()
  if (c === 'materials') return 'Material Cost'
  if (c === 'labour') return 'Manpower Cost'
  if (['transport', 'logistics', 'equipment'].includes(c)) return 'Freight & Logistics'
  if (['subcontractor', 'permits', 'site'].includes(c)) return 'Site/Project Expense'
  if (['office', 'administrative', 'utilities'].includes(c)) return 'Administrative Expense'
  return 'Other Expense'
}

const mapManualExpenseRecord = (expense) => {
  const approved = ['approved', 'paid'].includes(expense.status)
  return {
    recordId: `manual:${expense._id}`,
    source: 'manual_expense',
    expenseType: expenseCategoryLabel(expense.category),
    category: expense.category,
    date: expense.date,
    description: expense.description || '',
    reference: expense.expenseId || String(expense._id),
    amount: round2(expense.amount || 0),
    approvalStatus: approved ? 'Approved' : 'Pending Approval',
    tab: approved ? 'approved' : 'pending',
    status: expense.status || 'pending',
  }
}

const buildExpenseRecordsForLead = async (leadId, expenseDateFilter) => {
  const [expenses, shipperRequests, deliveries, approvals] = await Promise.all([
    Expense.find({ leadId, isActive: true, ...expenseDateFilter })
      .select('expenseId category date description amount status')
      .lean(),
    ShipperRequest.find({ leadId }).select('_id quoteValue status submittedAt reviewedAt').lean(),
    Delivery.find({ leadId }).select('_id').lean(),
    PaymentApproval.find({ leadId })
      .select('paymentId amount status notes invoiceNumber createdAt paidAt category payee')
      .lean(),
  ])

  const lineTotals = await loadLineTotalsByRequestId(shipperRequests.map((r) => r._id))
  const deliveryIds = deliveries.map((d) => d._id)
  const freightRows = deliveryIds.length
    ? await FreightBid.find({ deliveryId: { $in: deliveryIds }, status: 'selected' })
        .select('_id quotedAmount createdAt deliveryId')
        .lean()
    : []

  const records = []

  for (const e of expenses) records.push(mapManualExpenseRecord(e))

  for (const sr of shipperRequests) {
    const amt = requestQuoteAmount(sr, lineTotals)
    if (amt <= 0) continue
    const approved = sr.status === 'approved'
    const pending = PENDING_SHIPPER_STATUSES.includes(sr.status)
    if (!approved && !pending) continue
    records.push({
      recordId: `shipper:${sr._id}`,
      source: 'vendor_material_bid',
      expenseType: 'Material Cost',
      category: 'materials',
      date: sr.reviewedAt || sr.submittedAt || null,
      description: 'Vendor / material quote (email bid)',
      reference: String(sr._id).slice(-8).toUpperCase(),
      amount: round2(amt),
      approvalStatus: approved ? 'Approved' : 'Pending Approval',
      tab: approved ? 'approved' : 'pending',
      status: sr.status,
    })
  }

  for (const fb of freightRows) {
    records.push({
      recordId: `freight:${fb._id}`,
      source: 'freight_bid',
      expenseType: 'Freight & Logistics',
      category: 'transport',
      date: fb.createdAt || null,
      description: 'Selected freight bid',
      reference: String(fb._id).slice(-8).toUpperCase(),
      amount: round2(fb.quotedAmount || 0),
      approvalStatus: 'Approved',
      tab: 'approved',
      status: 'selected',
    })
  }

  for (const a of approvals) {
    const approved = a.status === 'approved'
    const pending = ['pending', 'under_review', 'disputed'].includes(a.status)
    if (!approved && !pending) continue
    records.push({
      recordId: `approval:${a._id}`,
      source: 'payment_approval',
      expenseType: expenseCategoryLabel(a.category?.replace('_payment', '') || 'other'),
      category: a.category,
      date: a.paidAt || a.createdAt,
      description: a.notes || a.payee || 'Payment approval',
      reference: a.invoiceNumber || a.paymentId,
      amount: round2(a.amount || 0),
      approvalStatus: approved ? 'Approved' : 'Pending Approval',
      tab: approved ? 'approved' : 'pending',
      status: a.status,
    })
  }

  records.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  return records
}

exports.getProjectWiseExpenseDetail = async (projectRef, query = {}) => {
  const lead = await resolveLead(projectRef)
  if (!lead) return { error: 'Project not found', code: 404 }

  const expenseDateFilter = buildDateFilter(query, 'date')
  const { page, limit, skip } = paginate(query)

  const rollup = await aggregateProjectExpensesForLead(lead._id, expenseDateFilter)
  let records = await buildExpenseRecordsForLead(lead._id, expenseDateFilter)

  const tab = String(query.tab || 'approved').toLowerCase()
  if (tab !== 'all') {
    records = records.filter((r) => r.tab === tab)
  }
  if (query.search?.trim()) {
    const re = new RegExp(query.search.trim(), 'i')
    records = records.filter(
      (r) =>
        re.test(r.description) ||
        re.test(r.reference) ||
        re.test(r.expenseType) ||
        re.test(r.category || '')
    )
  }

  const total = records.length
  const transactions = records.slice(skip, skip + limit)

  return {
    project: buildProjectHeader(lead),
    summary: {
      totalExpense: rollup.totalExpense,
      approvedExpense: rollup.approvedExpense,
      pendingApproval: rollup.pendingApproval,
      budgetedExpense: rollup.budgetedExpense,
      budgetVariance: rollup.budgetVariance,
      variancePct:
        rollup.budgetedExpense > 0
          ? round2((rollup.budgetVariance / rollup.budgetedExpense) * 100)
          : 0,
      sources: {
        manualExpenses: rollup.manualExpenseTotal,
        vendorMaterialFromEmailBids: rollup.vendorMaterialFromBids,
        freightFromEmailBids: rollup.freightFromBids,
      },
    },
    transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

exports.getProjectWiseExpenseRecord = async (projectRef, recordId) => {
  const lead = await resolveLead(projectRef)
  if (!lead) return { error: 'Project not found', code: 404 }

  const [source, id] = String(recordId).split(':')
  if (!source || !id) return { error: 'Invalid recordId format', code: 400 }

  const records = await buildExpenseRecordsForLead(lead._id, {})
  const row = records.find((r) => r.recordId === `${source}:${id}`)
  if (!row) return { error: 'Expense record not found', code: 404 }

  let detail = null
  if (source === 'manual') {
    detail = await Expense.findOne({ _id: id, leadId: lead._id }).lean()
  } else if (source === 'shipper') {
    detail = await ShipperRequest.findOne({ _id: id, leadId: lead._id }).lean()
  } else if (source === 'freight') {
    detail = await FreightBid.findById(id).lean()
  } else if (source === 'approval') {
    detail = await PaymentApproval.findOne({ _id: id, leadId: lead._id }).lean()
  }

  return { record: row, detail, project: buildProjectHeader(lead) }
}

exports.INCOME_TYPES = INCOME_TYPES
