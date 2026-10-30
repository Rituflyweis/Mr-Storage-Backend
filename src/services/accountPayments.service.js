const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const Expense = require('../models/Expense')
const Invoice = require('../models/Invoice')
const EstimateQuote = require('../models/EstimateQuote')
const PaymentSchedule = require('../models/PaymentSchedule')
const { buildPeriodDateFilter } = require('../utils/dateRange')
const {
  buildFinancialLeadMatch,
  distinctFinancialLeadIds,
  isLeadInFinancialScope,
} = require('../utils/financialProjectScope')
const {
  resolveQuotationFinancials,
  getLatestQuotationByLead,
} = require('../utils/quotationMargin.util')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const STATUS_LABELS = {
  in_progress: 'In progress',
  started: 'Started',
  completed: 'Completed',
  on_hold: 'On hold',
}

const CUSTOMER_INVOICE_MATCH = {
  invoiceType: { $nin: ['vendor', 'freight_carrier'] },
  status: { $ne: 'cancelled' },
}

const normalizeStatusFilter = (status) => {
  if (!status || String(status).toLowerCase() === 'all') return null
  const key = String(status).toLowerCase().replace(/\s+/g, '_')
  const map = {
    in_progress: 'in_progress',
    inprogress: 'in_progress',
    started: 'started',
    completed: 'completed',
    on_hold: 'on_hold',
  }
  return map[key] || null
}

const customerNameFromLead = (lead) => {
  const c = lead?.customerId
  if (!c) return ''
  if (typeof c === 'object') {
    return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.firstName || ''
  }
  return ''
}

/** Map payment-schedule / invoice labels → deposit | progress | final. */
const classifyPaymentBucket = (label = '', index = 0, total = 1) => {
  const n = String(label || '').toLowerCase()
  if (/deposit|down\s*payment|retainer/.test(n)) return 'deposit'
  if (/final|balance|retention|completion|last/.test(n)) return 'final'
  if (/progress|install|milestone|partial|progress/.test(n)) return 'progress'
  if (total <= 1) return 'deposit'
  if (index === 0) return 'deposit'
  if (index >= total - 1) return 'final'
  return 'progress'
}

const deriveStatusCode = ({ totalReceived, outstanding, lifecycleStatus }) => {
  if (lifecycleStatus === 'on_hold') return 'on_hold'
  if (totalReceived > 0 && outstanding <= 0) return 'completed'
  if (totalReceived > 0) return 'started'
  return 'in_progress'
}

const resolveOrderValue = (lead, quotation, estimate) => {
  if (estimate?.revisedContractTotal != null && Number.isFinite(Number(estimate.revisedContractTotal))) {
    return round2(estimate.revisedContractTotal)
  }
  if (estimate?.originalContractValue != null && Number.isFinite(Number(estimate.originalContractValue))) {
    const base = round2(estimate.originalContractValue)
    if (base > 0) return base
  }
  const fin = resolveQuotationFinancials(quotation, lead, estimate)
  if (fin.revenue > 0) return fin.revenue
  return round2(lead?.quoteValue || 0)
}

const resolveCurrentCost = (expenseTotal, quotation, lead, estimate) => {
  if (expenseTotal > 0) return round2(expenseTotal)
  const fin = resolveQuotationFinancials(quotation, lead, estimate)
  return round2(fin.cogs || 0)
}

/**
 * Build payment overview rows from PO/plant leads:
 * orderValue = quotation (incl. CO revised total when present)
 * received   = paid customer invoices
 */
const buildOverviewRows = async (leads, query = {}) => {
  if (!leads.length) return []

  const leadIds = leads.map((l) => l._id)
  const paidDateFilter = buildPeriodDateFilter(query, 'paidAt')
  // When period/startDate set, also accept invoice.date if paidAt missing.
  const hasDateScope = Boolean(query.period || query.startDate || query.endDate)

  const [quotationByLead, schedules, invoices, expenseAgg, estimates] = await Promise.all([
    getLatestQuotationByLead(leadIds),
    PaymentSchedule.find({ leadId: { $in: leadIds } }).select('leadId stages').lean(),
    Invoice.find({
      leadId: { $in: leadIds },
      ...CUSTOMER_INVOICE_MATCH,
      status: 'paid',
    })
      .select('leadId totalAmount status paidAt date description paymentScheduleStageId invoiceNumber')
      .sort({ paidAt: -1, date: -1 })
      .lean(),
    Expense.aggregate([
      { $match: { leadId: { $in: leadIds }, isActive: true } },
      { $group: { _id: '$leadId', total: { $sum: '$amount' } } },
    ]),
    EstimateQuote.find({
      _id: {
        $in: [...quotationByLead.values()]
          .map((q) => q.sourceEstimateId)
          .filter(Boolean),
      },
    })
      .select(
        'totalSell totalCOGS materialCost freightCost installCost marginPercent revisedContractTotal originalContractValue fullQuoteResult pricingResult'
      )
      .lean(),
  ])

  const estimateById = new Map(estimates.map((e) => [String(e._id), e]))
  const scheduleByLead = new Map(schedules.map((s) => [String(s.leadId), s]))
  const expenseByLead = new Map(expenseAgg.map((e) => [String(e._id), e.total || 0]))

  const stageBucketById = new Map()
  for (const sched of schedules) {
    const stages = sched.stages || []
    stages.forEach((st, idx) => {
      stageBucketById.set(String(st._id), classifyPaymentBucket(st.stageName, idx, stages.length))
    })
  }

  const inPaidDateRange = (inv) => {
    if (!hasDateScope) return true
    const when = inv.paidAt || inv.date
    if (!when) return false
    const range = paidDateFilter.paidAt
    if (!range) {
      // period filter may have been built on paidAt; if empty, try date field filter
      const dateFilter = buildPeriodDateFilter(query, 'date')
      const dr = dateFilter.date
      if (!dr) return true
      const t = new Date(when).getTime()
      if (dr.$gte && t < new Date(dr.$gte).getTime()) return false
      if (dr.$lte && t > new Date(dr.$lte).getTime()) return false
      return true
    }
    const t = new Date(when).getTime()
    if (range.$gte && t < new Date(range.$gte).getTime()) return false
    if (range.$lte && t > new Date(range.$lte).getTime()) return false
    return true
  }

  const paidByLead = new Map()
  for (const inv of invoices) {
    const key = String(inv.leadId)
    if (!paidByLead.has(key)) paidByLead.set(key, [])
    paidByLead.get(key).push(inv)
  }

  return leads.map((lead) => {
    const key = String(lead._id)
    const quotation = quotationByLead.get(key) || null
    const estimate = quotation?.sourceEstimateId
      ? estimateById.get(String(quotation.sourceEstimateId))
      : null
    const orderValue = resolveOrderValue(lead, quotation, estimate)
    const currentCost = resolveCurrentCost(expenseByLead.get(key) || 0, quotation, lead, estimate)

    const allPaid = paidByLead.get(key) || []
    // Row breakdown / outstanding always use all-time paid so orderValue − received stays coherent.
    const scopedPaid = hasDateScope ? allPaid.filter(inPaidDateRange) : allPaid

    let deposit = 0
    let progress = 0
    let finalPaid = 0
    const paymentHistory = []

    const sched = scheduleByLead.get(key)
    const stageCount = sched?.stages?.length || allPaid.length || 1

    allPaid.forEach((inv, idx) => {
      let bucket = 'progress'
      if (inv.paymentScheduleStageId && stageBucketById.has(String(inv.paymentScheduleStageId))) {
        bucket = stageBucketById.get(String(inv.paymentScheduleStageId))
      } else {
        bucket = classifyPaymentBucket(inv.description || '', idx, stageCount)
      }
      const amt = Number(inv.totalAmount) || 0
      if (bucket === 'deposit') deposit += amt
      else if (bucket === 'final') finalPaid += amt
      else progress += amt

      paymentHistory.push({
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber || '',
        amount: round2(amt),
        paymentType: bucket,
        paidAt: inv.paidAt || inv.date || null,
        description: inv.description || '',
      })
    })

    const totalReceivedAllTime = deposit + progress + finalPaid
    const totalReceivedScoped = hasDateScope
      ? scopedPaid.reduce((s, inv) => s + (Number(inv.totalAmount) || 0), 0)
      : totalReceivedAllTime

    const outstanding = round2(Math.max(0, orderValue - totalReceivedAllTime))
    const wipProfit = round2(totalReceivedAllTime - currentCost)
    const marginPct = orderValue > 0 ? round2((wipProfit / orderValue) * 100) : 0
    const statusCode = deriveStatusCode({
      totalReceived: totalReceivedAllTime,
      outstanding,
      lifecycleStatus: lead.lifecycleStatus,
    })

    return {
      wipId: lead._id,
      leadId: lead._id,
      quotationId: quotation?._id || null,
      orderDetails: {
        customerName: customerNameFromLead(lead),
        orderId: lead.jobId || '',
        quoteOrderId: lead.jobId || '',
        location: lead.location || '',
      },
      orderValue,
      currentCost,
      paymentBreakdown: {
        deposit: round2(deposit),
        progress: round2(progress),
        final: round2(finalPaid),
      },
      outstanding,
      profit: wipProfit,
      marginPct,
      status: STATUS_LABELS[statusCode] || statusCode,
      statusCode,
      totalReceived: round2(totalReceivedAllTime),
      /** Period-scoped received (for stats when date filter applied). */
      periodReceived: round2(totalReceivedScoped),
      payments: paymentHistory,
      notes: '',
      projectName: lead.projectName || '',
      lifecycleStatus: lead.lifecycleStatus || '',
      updatedAt: lead.updatedAt,
      createdAt: lead.createdAt,
      _lead: lead,
      _quotation: quotation,
    }
  })
}

exports.mapOrderRow = (row) => ({
  wipId: row.wipId,
  leadId: row.leadId,
  orderDetails: row.orderDetails,
  orderValue: round2(row.orderValue),
  currentCost: round2(row.currentCost),
  paymentBreakdown: {
    deposit: round2(row.paymentBreakdown?.deposit),
    progress: round2(row.paymentBreakdown?.progress),
    final: round2(row.paymentBreakdown?.final),
  },
  outstanding: round2(row.outstanding),
  profit: round2(row.profit),
  marginPct: row.marginPct,
  status: row.status,
  statusCode: row.statusCode,
  totalReceived: round2(row.totalReceived),
})

exports.mapOrderDetail = (row) => {
  const mapped = exports.mapOrderRow(row)
  return {
    ...mapped,
    profile: {
      quoteId: row.orderDetails?.orderId || '',
      quoteOrderId: row.orderDetails?.quoteOrderId || '',
      customerName: mapped.orderDetails.customerName,
      orderValue: mapped.orderValue,
      projectName: row.projectName || '',
      location: row.orderDetails?.location || '',
    },
    financials: {
      deposit: mapped.paymentBreakdown.deposit,
      progress: mapped.paymentBreakdown.progress,
      final: mapped.paymentBreakdown.final,
      profit: mapped.profit,
      outstanding: mapped.outstanding,
      totalPayable: mapped.outstanding,
      totalReceived: mapped.totalReceived,
      marginPct: mapped.marginPct,
    },
    paymentStatus: mapped.status,
    paymentStatusCode: mapped.statusCode,
    notes: row.notes || '',
    payments: row.payments || [],
    quotationId: row.quotationId || null,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  }
}

const loadScopedLeads = async (query = {}) => {
  const { search, status } = query
  const filter = buildFinancialLeadMatch()

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const customers = await Customer.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    })
      .select('_id')
      .lean()
    const customerIds = customers.map((c) => c._id)
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { projectName: regex },
          { jobId: regex },
          { location: regex },
          ...(customerIds.length ? [{ customerId: { $in: customerIds } }] : []),
        ],
      },
    ]
  }

  const leads = await Lead.find(filter)
    .populate('customerId', 'firstName lastName email')
    .select('projectName jobId location customerId lifecycleStatus quoteValue updatedAt createdAt')
    .sort({ updatedAt: -1 })
    .lean()

  const rows = await buildOverviewRows(leads, query)
  const statusCode = normalizeStatusFilter(status)
  if (!statusCode) return rows
  return rows.filter((r) => r.statusCode === statusCode)
}

exports.computePaymentStats = async (query = {}) => {
  const rows = await loadScopedLeads(query)
  const hasDateScope = Boolean(query.period || query.startDate || query.endDate)

  let totalOrderValue = 0
  let totalReceived = 0
  let outstanding = 0
  let totalWipProfit = 0

  for (const r of rows) {
    totalOrderValue += r.orderValue || 0
    totalReceived += hasDateScope ? r.periodReceived || 0 : r.totalReceived || 0
    outstanding += r.outstanding || 0
    totalWipProfit += r.profit || 0
  }

  return {
    totalOrderValue: round2(totalOrderValue),
    totalReceived: round2(totalReceived),
    outstanding: round2(outstanding),
    totalWipProfit: round2(totalWipProfit),
  }
}

exports.listOrders = async (query = {}) => {
  const { page = 1, limit = 20 } = query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const rows = await loadScopedLeads(query)
  const pageRows = rows.slice(skip, skip + parsedLimit)

  const hasDateScope = Boolean(query.period || query.startDate || query.endDate)
  let totalOrderValue = 0
  let totalReceived = 0
  let outstanding = 0
  let totalWipProfit = 0
  for (const r of rows) {
    totalOrderValue += r.orderValue || 0
    totalReceived += hasDateScope ? r.periodReceived || 0 : r.totalReceived || 0
    outstanding += r.outstanding || 0
    totalWipProfit += r.profit || 0
  }

  return {
    stats: {
      totalOrderValue: round2(totalOrderValue),
      totalReceived: round2(totalReceived),
      outstanding: round2(outstanding),
      totalWipProfit: round2(totalWipProfit),
    },
    orders: pageRows.map(exports.mapOrderRow),
    total: rows.length,
    page: parsedPage,
    limit: parsedLimit,
  }
}

exports.listOrdersForExport = async (query = {}) => {
  const data = await exports.listOrders({ ...query, page: 1, limit: 5000 })
  return data.orders
}

exports.resolveWip = async (idOrLeadId) => {
  if (!idOrLeadId) return null

  let lead = await Lead.findById(idOrLeadId)
    .populate('customerId', 'firstName lastName email')
    .select('projectName jobId location customerId lifecycleStatus quoteValue updatedAt createdAt')
    .lean()

  if (!lead) {
    lead = await Lead.findOne({ jobId: idOrLeadId })
      .populate('customerId', 'firstName lastName email')
      .select('projectName jobId location customerId lifecycleStatus quoteValue updatedAt createdAt')
      .lean()
  }
  if (!lead) return null
  if (!(await isLeadInFinancialScope(lead._id))) return null

  const rows = await buildOverviewRows([lead], {})
  return rows[0] || null
}

exports.listOrderOptions = async (query = {}) => {
  const { search, limit = 50 } = query
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)

  const filter = {
    ...buildFinancialLeadMatch(),
    jobId: { $exists: true, $nin: [null, ''] },
  }

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const customers = await Customer.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    })
      .select('_id')
      .lean()
    const customerIds = customers.map((c) => c._id)
    filter.$or = [
      { projectName: regex },
      { jobId: regex },
      { location: regex },
      ...(customerIds.length ? [{ customerId: { $in: customerIds } }] : []),
    ]
  }

  const leads = await Lead.find(filter)
    .populate('customerId', 'firstName lastName email')
    .select('projectName jobId location quoteValue lifecycleStatus customerId')
    .sort({ updatedAt: -1 })
    .limit(parsedLimit)
    .lean()

  const leadIds = leads.map((l) => l._id)
  const quotationByLead = await getLatestQuotationByLead(leadIds)
  const estimateIds = [...quotationByLead.values()].map((q) => q.sourceEstimateId).filter(Boolean)
  const estimates = estimateIds.length
    ? await EstimateQuote.find({ _id: { $in: estimateIds } })
        .select('revisedContractTotal originalContractValue totalSell fullQuoteResult pricingResult')
        .lean()
    : []
  const estimateById = new Map(estimates.map((e) => [String(e._id), e]))

  const options = leads.map((lead) => {
    const customerName = customerNameFromLead(lead)
    const quoteOrderId = lead.jobId || ''
    const projectName = lead.projectName || customerName || 'Project'
    const label = [quoteOrderId, customerName, projectName].filter(Boolean).join(' — ')
    const quotation = quotationByLead.get(String(lead._id))
    const estimate = quotation?.sourceEstimateId
      ? estimateById.get(String(quotation.sourceEstimateId))
      : null
    const quoteValue = resolveOrderValue(lead, quotation, estimate)
    return {
      leadId: lead._id,
      quoteOrderId,
      label,
      projectName: lead.projectName || '',
      customerName,
      location: lead.location || '',
      quoteValue,
      lifecycleStatus: lead.lifecycleStatus,
      hasWipRecord: false,
      wipId: lead._id,
    }
  })

  return { options, total: options.length }
}

exports.resolveLeadForOrder = async (quoteOrderId, leadId) => {
  if (leadId) {
    return Lead.findById(leadId).lean()
  }
  if (!quoteOrderId) return null
  return Lead.findOne({
    $or: [{ jobId: quoteOrderId }, { _id: quoteOrderId }],
  }).lean()
}

/**
 * Manual WIP create/update is disabled — overview is derived from quotation + paid invoices.
 * Kept so routes do not 500; returns a clear error.
 */
exports.upsertOrder = async () => ({
  error:
    'Payment overview is calculated from quotation amount and paid invoices for PO projects. Mark customer invoices as paid instead of creating a payment row.',
})

/** @deprecated WIP recompute — overview no longer stores WIP rows. */
const recomputeWipFields = (doc) => {
  const orderValue = Number(doc.orderValue) || 0
  const currentCost = Number(doc.currentCost) || 0
  const depositPaid = Number(doc.depositPaid) || 0
  const progressPaid = Number(doc.progressPaid) || 0
  const finalPaid = Number(doc.finalPaid) || 0
  const totalReceived = depositPaid + progressPaid + finalPaid
  doc.outstanding = round2(Math.max(0, orderValue - totalReceived))
  doc.wipProfit = round2(totalReceived - currentCost)
  doc.marginPct = orderValue > 0 ? round2((doc.wipProfit / orderValue) * 100) : 0
  return doc
}

exports.STATUS_LABELS = STATUS_LABELS
exports.normalizeStatusFilter = normalizeStatusFilter
exports.recomputeWipFields = recomputeWipFields
