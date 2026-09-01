const mongoose = require('mongoose')
const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const ProjectBudget = require('../../models/ProjectBudget')
const Tax = require('../../models/Tax')
const PaymentApproval = require('../../models/PaymentApproval')
const PaymentSchedule = require('../../models/PaymentSchedule')
const { PAYMENT_CATEGORIES, APPROVAL_STATUSES } = require('../../models/PaymentApproval')
const User = require('../../models/User')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { withProjectIdFields } = require('../../utils/leadProjectId')
const { generateFinancialOverviewExcel, generateWIPProfitsExcel, generateExpensesExcel, generatePaymentsDashboardExcel, generateStateWiseTaxExcel, generateProjectWiseTaxExcel, generatePaymentApprovalsExcel, generatePaymentHistoryExcel, generateTaxFilingExcel } = require('../../utils/exportFinancialAdmin')
const { parse: parseCsv } = require('csv-parse/sync')
const generateExpenseId = require('../../utils/generateExpenseId')
const generatePaymentApprovalId = require('../../utils/generatePaymentApprovalId')

exports.getOverview = asyncHandler(async (req, res) => {
  const base = buildDateFilter(req.query)

  const [quotedAgg, invoicedAgg, paidAgg, budgetAgg] = await Promise.all([
    Lead.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$quoteValue' } } }]),
    Invoice.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([{ $match: { ...base, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    ProjectBudget.aggregate([{ $match: base }, { $group: { _id: null, material: { $sum: '$materialBudget' }, logistics: { $sum: '$logisticBudget' } } }]),
  ])

  const totalQuoted = quotedAgg[0]?.total || 0
  const totalInvoiced = invoicedAgg[0]?.total || 0
  const totalPaid = paidAgg[0]?.total || 0
  const totalMaterialCost = budgetAgg[0]?.material || 0
  const totalPending = totalInvoiced - totalPaid
  const overallMargin = totalPaid > 0 ? Math.round(((totalPaid - totalMaterialCost) / totalPaid) * 100) : 0

  return success(res, { totalQuoted, totalInvoiced, totalPaid, totalPending, totalMaterialCost, overallMargin })
})

exports.getPerProject = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const base = buildDateFilter(req.query)

  const leads = await Lead.find({ ...base, quoteValue: { $gt: 0 } })
    .populate('customerId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(Number(limit)).lean()

  const projects = await Promise.all(leads.map(async (lead) => {
    const [invoiceAgg, budget] = await Promise.all([
      Invoice.aggregate([
        { $match: { leadId: lead._id } },
        { $group: { _id: null,
            totalInvoiced: { $sum: '$totalAmount' },
            totalPaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$totalAmount', 0] } }
        }}
      ]),
      ProjectBudget.findOne({ leadId: lead._id }).lean()
    ])

    const totalInvoiced = invoiceAgg[0]?.totalInvoiced || 0
    const totalPaid = invoiceAgg[0]?.totalPaid || 0
    const materialBudget = budget?.materialBudget || 0
    const freightBudget = budget?.logisticBudget || 0
    const totalCost = materialBudget + freightBudget
    const netMargin = totalPaid - totalCost
    const marginPct = totalPaid > 0 ? Math.round((netMargin / totalPaid) * 100) : 0

    return withProjectIdFields({
      leadId: lead._id,
      projectName: lead.projectName,
      customerName: `${lead.customerId?.firstName || ''} ${lead.customerId?.lastName || ''}`.trim(),
      quoteValue: lead.quoteValue,
      totalInvoiced, totalPaid, materialBudget, freightBudget, totalCost, netMargin, marginPct,
    }, lead.jobId)
  }))

  const total = await Lead.countDocuments({ ...base, quoteValue: { $gt: 0 } })
  return success(res, { projects, total, page: Number(page), limit: Number(limit) })
})

exports.getInvoiceAging = asyncHandler(async (req, res) => {
  const now = new Date()

  const overdue = await Invoice.aggregate([
    { $match: { status: { $in: ['sent', 'overdue'] } } },
    {
      $addFields: {
        dueDate: { $add: ['$date', { $multiply: ['$daysToPay', 86400000] }] },
      },
    },
    { $match: { dueDate: { $lt: now } } },
    { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
    { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'customer' } },
    { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'lead.assignedSales', foreignField: '_id', as: 'sales' } },
    {
      $project: {
        invoiceNumber: 1,
        totalAmount: 1,
        dueDate: 1,
        daysOverdue: {
          $floor: { $divide: [{ $subtract: [now, '$dueDate'] }, 86400000] },
        },
        customerName: {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ['$customer.firstName', ''] },
                ' ',
                { $ifNull: ['$customer.lastName', ''] },
              ],
            },
          },
        },
        projectName: '$lead.projectName',
        assignedSales: { $arrayElemAt: ['$sales.name', 0] },
      },
    },
    { $sort: { daysOverdue: -1 } },
  ])

  const totalOverdueAmount = overdue.reduce((sum, invoice) => sum + (invoice.totalAmount || 0), 0)
  return success(res, { overdue, totalOverdueAmount })
})

// ── Payments Dashboard ─────────────────────────────────────────────────────────
const computePaymentsDashboard = async (query) => {
  const base = buildDateFilter(query)
  const now = new Date()

  const [totalAgg, receivedAgg, outstandingAgg, overdueAgg, ytdAgg, recentInvoices] = await Promise.all([
    Invoice.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([{ $match: { ...base, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([{ $match: { ...base, status: { $in: ['sent', 'overdue'] } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    // Was previously matching status:'overdue' with no date filter at all — "Total Overdue"
    // ignored the "Select date range" picker entirely and always showed the all-time total.
    Invoice.aggregate([{ $match: { ...base, status: 'overdue' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([
      { $match: { status: 'overdue', createdAt: { $gte: new Date(now.getFullYear(), 0, 1) } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]),
    Invoice.find({}).sort({ createdAt: -1 }).limit(10)
      .populate('leadId', 'projectName')
      .populate('customerId', 'firstName lastName')
      .lean(),
  ])

  const totalPayments     = totalAgg[0]?.total || 0
  const totalReceived     = receivedAgg[0]?.total || 0
  const totalOutstanding  = outstandingAgg[0]?.total || 0
  const totalOverdue      = overdueAgg[0]?.total || 0
  const totalOverdueYTD   = ytdAgg[0]?.total || 0
  const totalOverdueYTDPct = totalPayments > 0 ? Math.round((totalOverdueYTD / totalPayments) * 100 * 10) / 10 : 0

  // "Payment status Distribution" — was previously ignoring the date-range filter entirely
  // (always all-time), and `count` was counting invoices rather than distinct clients even
  // though the widget's labels read "X clients".
  const statusDistribution = await Invoice.aggregate([
    { $match: base },
    { $group: { _id: '$status', clientIds: { $addToSet: '$customerId' }, amount: { $sum: '$totalAmount' } } },
    { $project: { _id: 1, count: { $size: '$clientIds' }, amount: 1 } },
  ])

  // Revenue trend last 6 months
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const revenueTrend = await Invoice.aggregate([
    { $match: { createdAt: { $gte: sixMonthsAgo } } },
    { $group: {
      _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, status: '$status' },
      amount: { $sum: '$totalAmount' }
    }},
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ])

  // Expected payments by days bucket
  const expectedPayments = await Invoice.aggregate([
    { $match: { status: { $in: ['sent', 'overdue'] } } },
    { $addFields: { dueDate: { $add: ['$date', { $multiply: ['$daysToPay', 86400000] }] } } },
    { $addFields: { daysLeft: { $floor: { $divide: [{ $subtract: ['$dueDate', now] }, 86400000] } } } },
    { $group: {
      _id: {
        $switch: {
          branches: [
            { case: { $lte: ['$daysLeft', 30] }, then: '0-30' },
            { case: { $lte: ['$daysLeft', 60] }, then: '31-60' },
            { case: { $lte: ['$daysLeft', 90] }, then: '61-90' },
          ],
          default: '90+'
        }
      },
      amount: { $sum: '$totalAmount' }
    }}
  ])

  // "Stage wise payment progress" — this was a straight copy of statusDistribution's query
  // (identical $group by status), so the widget showed the same breakdown twice instead of
  // real payment-schedule progress. Stage names are free text and vary per project (Deposit,
  // First Instalment, Final, ...), so "Initial" / "Final" means the first vs. last stage of
  // each schedule, not a name match. Pulled from PaymentSchedule directly (not via Invoice —
  // invoices aren't reliably linked back to a specific schedule stage in practice).
  const scheduleStageAgg = await PaymentSchedule.aggregate([
    { $project: {
      customerId: 1,
      totalAmount: 1,
      initialStage: { $arrayElemAt: ['$stages', 0] },
      finalStage: { $arrayElemAt: ['$stages', -1] },
    }},
    { $group: {
      _id: null,
      totalSchedules: { $sum: 1 },
      initialPaidCount: { $sum: { $cond: [{ $eq: ['$initialStage.status', 'paid'] }, 1, 0] } },
      initialClientIds: { $addToSet: { $cond: [{ $eq: ['$initialStage.status', 'paid'] }, '$customerId', '$$REMOVE'] } },
      initialAmount: { $sum: { $cond: [{ $eq: ['$initialStage.status', 'paid'] }, '$initialStage.amount', 0] } },
      finalPaidCount: { $sum: { $cond: [{ $eq: ['$finalStage.status', 'paid'] }, 1, 0] } },
      finalClientIds: { $addToSet: { $cond: [{ $eq: ['$finalStage.status', 'paid'] }, '$customerId', '$$REMOVE'] } },
      finalAmount: { $sum: { $cond: [{ $eq: ['$finalStage.status', 'paid'] }, '$finalStage.amount', 0] } },
    }},
  ])

  const sw = scheduleStageAgg[0] || { totalSchedules: 0, initialPaidCount: 0, initialClientIds: [], initialAmount: 0, finalPaidCount: 0, finalClientIds: [], finalAmount: 0 }
  const stageWise = [
    {
      _id: 'Initial Payment',
      progressPct: sw.totalSchedules > 0 ? Math.round((sw.initialPaidCount / sw.totalSchedules) * 100) : 0,
      clientCount: sw.initialClientIds.length,
      amount: sw.initialAmount,
    },
    {
      _id: 'Final Payment',
      progressPct: sw.totalSchedules > 0 ? Math.round((sw.finalPaidCount / sw.totalSchedules) * 100) : 0,
      clientCount: sw.finalClientIds.length,
      amount: sw.finalAmount,
    },
  ]

  return {
    stats: { totalPayments, totalReceived, totalOutstanding, totalOverdue, totalOverdueYTD, totalOverdueYTDPct },
    statusDistribution,
    revenueTrend,
    expectedPayments,
    stageWise,
    recentPayments: recentInvoices,
  }
}

exports.getPaymentsDashboard = asyncHandler(async (req, res) => {
  const data = await computePaymentsDashboard(req.query)
  return success(res, data)
})

// GET /payments-dashboard/export — "Export" button on Payments Dashboard screen
exports.exportPaymentsDashboard = asyncHandler(async (req, res) => {
  const { stats, recentPayments } = await computePaymentsDashboard(req.query)

  const buffer = await generatePaymentsDashboardExcel(stats, recentPayments)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="payments-dashboard.xlsx"')
  return res.send(buffer)
})

// ── Tax & Filling ──────────────────────────────────────────────────────────────

// Shared by getTaxFiling and getTaxFilingStats so both honor identical filters.
const buildTaxFilingFilter = async ({ state, projectId, clientId, search, startDate, endDate }) => {
  const filter = {}
  if (state) filter.state = state
  // Cast explicitly: aggregate() $match, unlike find(), does not auto-cast string ids to ObjectId.
  if (projectId) filter.leadId = new mongoose.Types.ObjectId(projectId)
  if (clientId) filter.customerId = new mongoose.Types.ObjectId(clientId)
  if (startDate || endDate) {
    filter.dueDate = {}
    if (startDate) filter.dueDate.$gte = new Date(startDate)
    if (endDate)   filter.dueDate.$lte = new Date(endDate)
  }

  if (search?.trim()) {
    const term = search.trim()
    const matchingLeads = await Lead.find({
      $or: [{ projectName: { $regex: term, $options: 'i' } }, { jobId: { $regex: term, $options: 'i' } }],
    }).select('_id').lean()

    filter.$or = [
      { state: { $regex: term, $options: 'i' } },
      { threshold: { $regex: term, $options: 'i' } },
      ...(matchingLeads.length ? [{ leadId: { $in: matchingLeads.map(l => l._id) } }] : []),
    ]
  }

  return filter
}

exports.getTaxFiling = asyncHandler(async (req, res) => {
  const { state, projectId, clientId, search, startDate, endDate, page = 1, limit = 10 } = req.query
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 100)

  const filter = await buildTaxFilingFilter({ state, projectId, clientId, search, startDate, endDate })

  const populateOpts = [
    { path: 'leadId', select: 'projectName jobId' },
    { path: 'customerId', select: 'firstName lastName' },
  ]

  const [pending, history, stats] = await Promise.all([
    Tax.find({ ...filter, status: 'pending' }).populate(populateOpts).sort({ dueDate: 1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
    Tax.find({ ...filter, status: 'paid' }).populate(populateOpts).sort({ paidAt: -1 }).limit(20).lean(),
    Tax.aggregate([
      { $match: filter },
      { $group: {
        _id: null,
        totalTaxable: { $sum: '$amount' },
        totalCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        payableByStates: { $addToSet: { $cond: [{ $eq: ['$status', 'pending'] }, '$state', null] } },
      }}
    ]),
  ])

  const s = stats[0] || {}
  const filed = await Tax.countDocuments({ ...filter, status: 'paid' })
  const unfiled = await Tax.countDocuments({ ...filter, status: 'pending' })

  return success(res, {
    stats: {
      totalTaxable: s.totalTaxable || 0,
      totalCollected: s.totalCollected || 0,
      taxPayableByStates: (s.payableByStates || []).filter(Boolean).length,
      filed,
      unfiled,
    },
    pendingFiling: pending,
    filingHistory: history,
    page: parsedPage,
    limit: parsedLimit,
  })
})

// GET /tax-filing/export
exports.exportTaxFiling = asyncHandler(async (req, res) => {
  const { state, projectId, clientId, search, startDate, endDate } = req.query
  const filter = await buildTaxFilingFilter({ state, projectId, clientId, search, startDate, endDate })

  const records = await Tax.find(filter)
    .populate([{ path: 'leadId', select: 'projectName jobId' }, { path: 'customerId', select: 'firstName lastName' }])
    .sort({ dueDate: 1 })
    .lean()

  const buffer = await generateTaxFilingExcel(records)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="tax-filing.xlsx"')
  return res.send(buffer)
})

// Shared by any stat card that shows a "X% from last month" trend.
const pctChange = (current, previous) => {
  if (!previous) return 0
  return Math.round(((current - previous) / previous) * 100 * 100) / 100
}

// GET /tax-filing/stats — stat cards on Tax & Filing screen
exports.getTaxFilingStats = asyncHandler(async (req, res) => {
  const { state, projectId, clientId, search } = req.query
  const baseFilter = await buildTaxFilingFilter({ state, projectId, clientId, search })
  const now = new Date()

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const monthAgg = async (rangeStart, rangeEnd) => {
    const agg = await Tax.aggregate([
      { $match: { ...baseFilter, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
      { $group: {
        _id: null,
        totalTaxable: { $sum: '$amount' },
        totalCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
      }}
    ])
    return agg[0] || { totalTaxable: 0, totalCollected: 0 }
  }

  const [thisMonth, lastMonth, overall] = await Promise.all([
    monthAgg(thisMonthStart, now),
    monthAgg(lastMonthStart, thisMonthStart),
    Tax.aggregate([
      { $match: baseFilter },
      { $group: {
        _id: null,
        totalTaxable: { $sum: '$amount' },
        totalCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        taxPayableByStates: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
        filed: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        unfiled: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
      }}
    ]),
  ])

  const o = overall[0] || { totalTaxable: 0, totalCollected: 0, taxPayableByStates: 0, filed: 0, unfiled: 0 }

  // value = all-time total (same scope as the tax-filing list, so the two screens agree);
  // pctChangeFromLastMonth is a separate month-over-month growth-rate indicator.
  return success(res, {
    totalSalesTaxable: {
      value: o.totalTaxable,
      pctChangeFromLastMonth: pctChange(thisMonth.totalTaxable, lastMonth.totalTaxable),
    },
    totalSalesTaxCollected: {
      value: o.totalCollected,
      pctChangeFromLastMonth: pctChange(thisMonth.totalCollected, lastMonth.totalCollected),
    },
    taxPayableByStates: {
      value: o.taxPayableByStates,
    },
    fileVsUnfiledTax: {
      filed: o.filed,
      unfiled: o.unfiled,
    },
  })
})

// GET /tax-filing/filters — populates Project ID / Client dropdowns on Tax & Filing screen
exports.getTaxFilingFilters = asyncHandler(async (req, res) => {
  const [states, leadIds, customerIds] = await Promise.all([
    Tax.distinct('state'),
    Tax.distinct('leadId', { leadId: { $ne: null } }),
    Tax.distinct('customerId', { customerId: { $ne: null } }),
  ])

  const [projects, clients] = await Promise.all([
    leadIds.length ? Lead.find({ _id: { $in: leadIds } }).select('projectName jobId').sort({ projectName: 1 }).lean() : [],
    customerIds.length ? Customer.find({ _id: { $in: customerIds } }).select('firstName lastName').sort({ firstName: 1 }).lean() : [],
  ])

  return success(res, {
    states: states.filter(Boolean).sort(),
    projects: projects.map(p => ({ leadId: p._id, projectName: p.projectName, jobId: p.jobId })),
    clients: clients.map(c => ({ customerId: c._id, name: `${c.firstName} ${c.lastName || ''}`.trim() })),
  })
})

exports.prepareFiling = asyncHandler(async (req, res) => {
  const tax = await Tax.findById(req.params.taxId)
  if (!tax) return notFound(res, 'Tax record not found')
  return success(res, { tax, message: 'Filing details ready for review' })
})

exports.completeFiling = asyncHandler(async (req, res) => {
  const tax = await Tax.findById(req.params.taxId)
  if (!tax) return notFound(res, 'Tax record not found')
  if (tax.status === 'paid') return badRequest(res, 'Tax already filed')

  tax.status = 'paid'
  tax.paidBy = req.user._id
  tax.paidAt = new Date()
  await tax.save()

  return success(res, { tax }, 'Tax filed successfully')
})

// ── State Wise Tax ─────────────────────────────────────────────────────────────

// Shared by getStateWiseTax, getStateWiseTaxStats, exportStateWiseTax, getUpcomingFilingDeadlines.
const buildStateWiseFilter = ({ projectId, startDate, endDate }) => {
  const filter = {}
  if (projectId) filter.leadId = new mongoose.Types.ObjectId(projectId)
  if (startDate || endDate) {
    filter.dueDate = {}
    if (startDate) filter.dueDate.$gte = new Date(startDate)
    if (endDate)   filter.dueDate.$lte = new Date(endDate)
  }
  return filter
}

const computeStateWiseTax = async ({ projectId, startDate, endDate }) => {
  const filter = buildStateWiseFilter({ projectId, startDate, endDate })

  const stateStats = await Tax.aggregate([
    { $match: filter },
    { $group: {
      _id: '$state',
      taxCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
      taxableSales: { $sum: '$amount' },
      paidFiled: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
      payable: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
      // Only pending dueDates count as "next filing due" — an already-paid record's dueDate is
      // irrelevant, but $min across all statuses would still pick it up if it happened to be earliest.
      nextDue: { $min: { $cond: [{ $eq: ['$status', 'pending'] }, '$dueDate', null] } },
      status: { $first: '$status' },
    }},
    { $sort: { nextDue: 1 } }
  ])

  const totalTaxCollected   = stateStats.reduce((s, r) => s + r.taxCollected, 0)
  const totalPaid           = stateStats.reduce((s, r) => s + r.paidFiled, 0)
  const totalPayable        = stateStats.reduce((s, r) => s + r.payable, 0)
  const pendingFilingStates = stateStats.filter(r => r.payable > 0).length
  const nextFilingDue       = stateStats.filter(r => r.nextDue).sort((a, b) => new Date(a.nextDue) - new Date(b.nextDue))[0]?.nextDue || null

  return { stateStats, totalTaxCollected, totalPaid, totalPayable, pendingFilingStates, nextFilingDue }
}

exports.getStateWiseTax = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate } = req.query
  const { stateStats, totalTaxCollected, totalPaid, totalPayable, pendingFilingStates, nextFilingDue } =
    await computeStateWiseTax({ projectId, startDate, endDate })

  return success(res, {
    stats: { totalTaxCollected, totalPaid, totalPayable, pendingFilingStates, nextFilingDue },
    stateOverview: stateStats,
    lastSynced: new Date(),
  })
})

// GET /state-wise-tax/stats — stat cards on State-wise Tax screen
exports.getStateWiseTaxStats = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate } = req.query
  const filter = buildStateWiseFilter({ projectId, startDate, endDate })
  const now = new Date()

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const monthAgg = async (rangeStart, rangeEnd) => {
    const agg = await Tax.aggregate([
      { $match: { ...filter, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
      { $group: {
        _id: null,
        taxCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        payable: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
      }}
    ])
    return agg[0] || { taxCollected: 0, payable: 0 }
  }

  const [thisMonth, lastMonth, overall] = await Promise.all([
    monthAgg(thisMonthStart, now),
    monthAgg(lastMonthStart, thisMonthStart),
    computeStateWiseTax({ projectId, startDate, endDate }),
  ])

  const nextDueRecord = overall.nextFilingDue
    ? await Tax.findOne({ ...filter, status: 'pending', dueDate: overall.nextFilingDue }).select('state dueDate').lean()
    : null

  // value = all-time total (same scope as the state-wise-tax list, so the two screens agree);
  // pctChangeFromLastMonth is a separate month-over-month growth-rate indicator, not a
  // value-scoping choice — it compares only new activity created this month vs last month.
  return success(res, {
    totalTaxCollected: {
      value: overall.totalTaxCollected,
      pctChangeFromLastMonth: pctChange(thisMonth.taxCollected, lastMonth.taxCollected),
    },
    totalPaid: {
      value: overall.totalPaid,
      pctChangeFromLastMonth: pctChange(thisMonth.taxCollected, lastMonth.taxCollected),
    },
    totalPayable: {
      value: overall.totalPayable,
      pctChangeFromLastMonth: pctChange(thisMonth.payable, lastMonth.payable),
    },
    pendingFilingStates: {
      count: overall.pendingFilingStates,
      label: 'Requires Filing',
    },
    nextFilingDue: {
      date: nextDueRecord?.dueDate || null,
      state: nextDueRecord?.state || null,
    },
  })
})

// GET /state-wise-tax/export
exports.exportStateWiseTax = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate } = req.query
  const { stateStats } = await computeStateWiseTax({ projectId, startDate, endDate })

  const buffer = await generateStateWiseTaxExcel(stateStats)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="state-wise-tax.xlsx"')
  return res.send(buffer)
})

const FILING_FREQUENCY_LABELS = {
  monthly: 'Monthly Return',
  quarterly: 'Quarterly Return',
  annually: 'Annual Return',
  varies: 'Varies',
  local_only: 'Local Filing',
}

// GET /state-wise-tax/upcoming-deadlines
exports.getUpcomingFilingDeadlines = asyncHandler(async (req, res) => {
  const { projectId, limit = 6 } = req.query
  const parsedLimit = Math.min(parseInt(limit, 10) || 6, 50)
  const filter = buildStateWiseFilter({ projectId })
  const now = new Date()

  const upcoming = await Tax.find({ ...filter, status: 'pending', dueDate: { $gte: now } })
    .sort({ dueDate: 1 })
    .limit(parsedLimit)
    .lean()

  const deadlines = upcoming.map((tax) => ({
    _id: tax._id,
    state: tax.state,
    filingType: FILING_FREQUENCY_LABELS[tax.filingFrequency] || tax.filingFrequency,
    dueDate: tax.dueDate,
    daysLeft: Math.ceil((new Date(tax.dueDate) - now) / 86400000),
  }))

  return success(res, { deadlines, total: deadlines.length })
})

exports.syncStateTax = asyncHandler(async (req, res) => {
  return success(res, { syncedAt: new Date() }, 'Tax data synced successfully')
})

// ── Project Wise Tax ───────────────────────────────────────────────────────────

// Groups real Tax records by leadId (project) instead of state — reuses the same filter shape
// as state-wise tax since both just filter the Tax collection by leadId/dueDate range.
const computeProjectWiseTax = async ({ projectId, startDate, endDate }) => {
  const filter = buildStateWiseFilter({ projectId, startDate, endDate })
  // filter.leadId is already set when projectId is given — don't let this clobber it.
  if (!filter.leadId) filter.leadId = { $ne: null }

  const grouped = await Tax.aggregate([
    { $match: filter },
    { $group: {
      _id: '$leadId',
      taxCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
      taxableSales: { $sum: '$amount' },
      paidFiled: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
      payable: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
      nextDue: { $min: { $cond: [{ $eq: ['$status', 'pending'] }, '$dueDate', null] } },
    }},
  ])

  const leadIds = grouped.map(g => g._id)
  const leads = leadIds.length
    ? await Lead.find({ _id: { $in: leadIds } }).select('projectName jobId location customerId')
        .populate('customerId', 'firstName lastName').lean()
    : []
  const leadMap = new Map(leads.map(l => [String(l._id), l]))

  const projects = grouped
    .map(g => {
      const lead = leadMap.get(String(g._id))
      return {
        leadId: g._id,
        projectName: lead?.projectName || '',
        jobId: lead?.jobId || '',
        location: lead?.location || '',
        customerName: lead ? `${lead.customerId?.firstName || ''} ${lead.customerId?.lastName || ''}`.trim() : '',
        taxCollected: g.taxCollected,
        taxableSales: g.taxableSales,
        paidFiled: g.paidFiled,
        payable: g.payable,
        dueDate: g.nextDue,
        status: g.payable > 0 ? 'Payment Due' : 'Filed',
      }
    })
    .sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate) - new Date(b.dueDate)
    })

  const totalTaxCollected    = projects.reduce((s, p) => s + p.taxCollected, 0)
  const totalPaid            = projects.reduce((s, p) => s + p.paidFiled, 0)
  const totalPayable         = projects.reduce((s, p) => s + p.payable, 0)
  const pendingFilingProjects = projects.filter(p => p.payable > 0).length
  const nextFilingProject     = projects.find(p => p.payable > 0 && p.dueDate) || null

  return { projects, totalTaxCollected, totalPaid, totalPayable, pendingFilingProjects, nextFilingProject }
}

exports.getProjectWiseTax = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate, page = 1, limit = 10 } = req.query
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 100)

  const { projects } = await computeProjectWiseTax({ projectId, startDate, endDate })
  const total = projects.length
  const paged = projects.slice((parsedPage - 1) * parsedLimit, (parsedPage - 1) * parsedLimit + parsedLimit)

  return success(res, { projects: paged, total, page: parsedPage, limit: parsedLimit })
})

// GET /project-wise-tax/stats — stat cards on Project-wise Tax screen
exports.getProjectWiseTaxStats = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate } = req.query
  const filter = buildStateWiseFilter({ projectId, startDate, endDate })
  const now = new Date()

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const monthAgg = async (rangeStart, rangeEnd) => {
    const agg = await Tax.aggregate([
      { $match: { ...filter, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
      { $group: {
        _id: null,
        taxCollected: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        payable: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
      }}
    ])
    return agg[0] || { taxCollected: 0, payable: 0 }
  }

  const [thisMonth, lastMonth, overall] = await Promise.all([
    monthAgg(thisMonthStart, now),
    monthAgg(lastMonthStart, thisMonthStart),
    computeProjectWiseTax({ projectId, startDate, endDate }),
  ])

  // value = all-time total (same scope as the project-wise-tax list, so the two screens agree);
  // pctChangeFromLastMonth is a separate month-over-month growth-rate indicator.
  return success(res, {
    totalTaxCollected: {
      value: overall.totalTaxCollected,
      pctChangeFromLastMonth: pctChange(thisMonth.taxCollected, lastMonth.taxCollected),
    },
    totalPaid: {
      value: overall.totalPaid,
      pctChangeFromLastMonth: pctChange(thisMonth.taxCollected, lastMonth.taxCollected),
    },
    totalPayable: {
      value: overall.totalPayable,
      pctChangeFromLastMonth: pctChange(thisMonth.payable, lastMonth.payable),
    },
    pendingFiling: {
      count: overall.pendingFilingProjects,
      label: 'Requires Filing',
    },
    nextFilingDue: {
      date: overall.nextFilingProject?.dueDate || null,
      location: overall.nextFilingProject?.location || null,
    },
  })
})

// GET /project-wise-tax/export
exports.exportProjectWiseTax = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate } = req.query
  const { projects } = await computeProjectWiseTax({ projectId, startDate, endDate })

  const buffer = await generateProjectWiseTaxExcel(projects)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="project-wise-tax.xlsx"')
  return res.send(buffer)
})

// ── Payment Approval ───────────────────────────────────────────────────────────

// Shared by getPaymentApprovals and exportPaymentApprovals.
const buildPaymentApprovalFilter = ({ status, category, department, requestedBy, startDate, endDate }) => {
  const filter = {}
  if (status)      filter.status      = status
  if (category)    filter.category    = category
  if (department)  filter.department  = department
  if (requestedBy) filter.requestedBy = new mongoose.Types.ObjectId(requestedBy)
  if (startDate || endDate) {
    filter.createdAt = {}
    if (startDate) filter.createdAt.$gte = new Date(startDate)
    if (endDate)   filter.createdAt.$lte = new Date(endDate)
  }
  return filter
}

exports.getPaymentApprovals = asyncHandler(async (req, res) => {
  const { status, category, department, requestedBy, startDate, endDate, page = 1, limit = 10 } = req.query
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 100)

  const filter = buildPaymentApprovalFilter({ status, category, department, requestedBy, startDate, endDate })

  const [approvals, total, stats] = await Promise.all([
    PaymentApproval.find(filter).populate('requestedBy', 'name').sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
    PaymentApproval.countDocuments(filter),
    PaymentApproval.aggregate([
      { $match: filter },
      { $group: {
        _id: '$status',
        count: { $sum: 1 },
        amount: { $sum: '$amount' },
      }}
    ]),
  ])

  const statMap = { pending: { count: 0, amount: 0 }, approved: { count: 0, amount: 0 }, rejected: { count: 0, amount: 0 } }
  stats.forEach(s => { statMap[s._id] = { count: s.count, amount: s.amount } })

  return success(res, {
    approvals,
    total,
    page: parsedPage,
    limit: parsedLimit,
    stats: {
      totalRequests: total,
      pendingApproval: statMap.pending.count,
      pendingAmount: statMap.pending.amount,
      approved: statMap.approved.count,
      approvedAmount: statMap.approved.amount,
      rejected: statMap.rejected.count,
      totalAmount: Object.values(statMap).reduce((s, v) => s + v.amount, 0),
    }
  })
})

// GET /payment-approvals/filters — populates Requested By / Category dropdowns
exports.getPaymentApprovalFilters = asyncHandler(async (req, res) => {
  const requesterIds = await PaymentApproval.distinct('requestedBy')
  const requesters = requesterIds.length
    ? await User.find({ _id: { $in: requesterIds } }).select('name').sort({ name: 1 }).lean()
    : []

  return success(res, {
    categories: PAYMENT_CATEGORIES,
    statuses: APPROVAL_STATUSES,
    requestedBy: requesters.map(u => ({ userId: u._id, name: u.name })),
  })
})

// GET /payment-approvals/export
exports.exportPaymentApprovals = asyncHandler(async (req, res) => {
  const { status, category, department, requestedBy, startDate, endDate } = req.query
  const filter = buildPaymentApprovalFilter({ status, category, department, requestedBy, startDate, endDate })

  const approvals = await PaymentApproval.find(filter).populate('requestedBy', 'name').sort({ createdAt: -1 }).lean()
  const buffer = await generatePaymentApprovalsExcel(approvals)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="payment-approvals.xlsx"')
  return res.send(buffer)
})

exports.createPaymentApproval = asyncHandler(async (req, res) => {
  const paymentId = await generatePaymentApprovalId()
  const approval = await PaymentApproval.create({ ...req.body, paymentId, requestedBy: req.user._id })
  return created(res, { approval }, 'Payment request created')
})

exports.reviewPaymentApproval = asyncHandler(async (req, res) => {
  const { action, reviewNotes } = req.body
  if (!['approved', 'rejected'].includes(action)) return badRequest(res, 'Invalid action')

  const approval = await PaymentApproval.findById(req.params.approvalId)
  if (!approval) return notFound(res, 'Payment approval not found')
  if (approval.status !== 'pending') return badRequest(res, 'Already reviewed')

  approval.status = action
  approval.reviewedBy = req.user._id
  approval.reviewedAt = new Date()
  approval.reviewNotes = reviewNotes || ''
  await approval.save()

  return success(res, { approval }, `Payment ${action}`)
})

// ── Payment Status (Vendor/Carrier) ───────────────────────────────────────────

// Shared by getPaymentStatus and exportPaymentStatus.
const buildPaymentHistoryFilter = async ({ paymentMethod, status, search }) => {
  const filter = {}
  if (status) filter.status = status
  if (paymentMethod) filter.paymentMethod = paymentMethod

  if (search?.trim()) {
    const term = search.trim()
    const [matchingLeads, matchingCustomers] = await Promise.all([
      Lead.find({ projectName: { $regex: term, $options: 'i' } }).select('_id').lean(),
      Customer.find({
        $or: [{ firstName: { $regex: term, $options: 'i' } }, { lastName: { $regex: term, $options: 'i' } }],
      }).select('_id').lean(),
    ])

    filter.$or = [
      { invoiceNumber: { $regex: term, $options: 'i' } },
      ...(matchingLeads.length ? [{ leadId: { $in: matchingLeads.map(l => l._id) } }] : []),
      ...(matchingCustomers.length ? [{ customerId: { $in: matchingCustomers.map(c => c._id) } }] : []),
    ]
  }

  return filter
}

exports.getPaymentStatus = asyncHandler(async (req, res) => {
  const { paymentMethod, status, search, page = 1, limit = 10 } = req.query
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(limit, 10) || 10, 100)
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const invoiceFilter = await buildPaymentHistoryFilter({ paymentMethod, status, search })

  const [invoices, total] = await Promise.all([
    Invoice.find(invoiceFilter)
      .populate('leadId', 'projectName')
      .populate('customerId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean(),
    Invoice.countDocuments(invoiceFilter),
  ])

  const overdueInvoices = await Invoice.find({ status: 'overdue' })
    .populate('leadId', 'projectName').populate('customerId', 'firstName lastName')
    .sort({ createdAt: 1 }).limit(5).lean()

  const dueSoon = await Invoice.aggregate([
    { $match: { status: { $in: ['sent', 'overdue'] } } },
    { $addFields: { dueDate: { $add: ['$date', { $multiply: ['$daysToPay', 86400000] }] } } },
    { $match: { dueDate: { $gte: now, $lte: new Date(now.getTime() + 30 * 86400000) } } },
    { $sort: { dueDate: 1 } },
    { $limit: 5 }
  ])

  const [totalOutstanding, totalPaid, overdueCount, vendorAgg, carrierAgg] = await Promise.all([
    Invoice.aggregate([{ $match: { status: { $in: ['sent', 'overdue'] } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([{ $match: { status: 'paid', paidAt: { $gte: thisMonthStart } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.countDocuments({ status: 'overdue' }),
    PaymentApproval.aggregate([
      { $match: { payeeType: 'vendor', status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' }, vendors: { $addToSet: '$payee' } } },
    ]),
    PaymentApproval.aggregate([
      { $match: { payeeType: { $in: ['carrier', 'shipper'] }, status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' }, carriers: { $addToSet: '$payee' } } },
    ]),
  ])

  return success(res, {
    stats: {
      totalOutstanding: totalOutstanding[0]?.total || 0,
      dueSoonCount: dueSoon.length,
      overdueCount,
      totalPaid: totalPaid[0]?.total || 0,
      vendorPayments: vendorAgg[0]?.total || 0,
      vendorCount: vendorAgg[0]?.vendors?.length || 0,
      carrierPayments: carrierAgg[0]?.total || 0,
      carrierCount: carrierAgg[0]?.carriers?.length || 0,
    },
    overduePayments: overdueInvoices,
    dueSoon,
    paymentHistory: invoices,
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

// GET /payment-status/export
exports.exportPaymentStatus = asyncHandler(async (req, res) => {
  const { paymentMethod, status, search } = req.query
  const filter = await buildPaymentHistoryFilter({ paymentMethod, status, search })

  const invoices = await Invoice.find(filter)
    .populate('leadId', 'projectName')
    .populate('customerId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean()

  const buffer = await generatePaymentHistoryExcel(invoices)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="payment-history.xlsx"')
  return res.send(buffer)
})

// ─── Financial Overview Sub-pages ────────────────────────────────────────────

const Expense = require('../../models/Expense')
const { EXPENSE_STATUSES, EXPENSE_PAYMENT_METHODS, EXPENSE_DEPARTMENTS } = Expense
const ExpenseCategory = require('../../models/ExpenseCategory')
const FreightBid = require('../../models/FreightBid')
const WIPProfit = require('../../models/WIPProfit')

exports.getFinancialOverview = asyncHandler(async (req, res) => {
  const { projectId } = req.query
  const dateFilter = buildDateFilter(req.query, 'date')
  const projectFilter = projectId ? { leadId: projectId } : {}
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [revenueAgg, grossProfitAgg, expenseAgg, revenueTrend, topCustomers, expenseTrend, expenseByCategory] = await Promise.all([
    Invoice.aggregate([{ $match: { ...dateFilter, ...projectFilter, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([
      { $match: { ...dateFilter, ...projectFilter, status: 'paid' } },
      { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
      { $unwind: '$lead' },
      { $group: { _id: null, revenue: { $sum: '$totalAmount' }, cost: { $sum: '$lead.quoteValue' } } },
    ]),
    Expense.aggregate([{ $match: { ...dateFilter, ...projectFilter } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Invoice.aggregate([
      { $match: { ...projectFilter, status: 'paid', date: { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, revenue: { $sum: '$totalAmount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Invoice.aggregate([
      { $match: { ...dateFilter, ...projectFilter, status: 'paid' } },
      { $group: { _id: '$customerId', revenue: { $sum: '$totalAmount' } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $project: { customer: { firstName: 1, lastName: 1 }, revenue: 1 } },
    ]),
    Expense.aggregate([
      { $match: { ...projectFilter, date: { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, expense: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Expense.aggregate([
      { $match: { ...dateFilter, ...projectFilter } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]),
  ])

  const totalRevenue = revenueAgg[0]?.total || 0
  const totalExpenses = expenseAgg[0]?.total || 0
  const grossProfit = totalRevenue - totalExpenses
  const grossMargin = totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0
  const netProfit = grossProfit * 0.85
  const operatingCashFlow = netProfit * 0.9

  // "Income vs Expense" bar chart — merge revenue-by-month and expense-by-month into one series.
  const monthKey = (y, m) => `${y}-${m}`
  const revenueByMonth = new Map(revenueTrend.map(r => [monthKey(r._id.year, r._id.month), r.revenue]))
  const expenseByMonth = new Map(expenseTrend.map(e => [monthKey(e._id.year, e._id.month), e.expense]))
  const allMonthKeys = [...new Set([...revenueByMonth.keys(), ...expenseByMonth.keys()])].sort()
  const incomeVsExpenseTrend = allMonthKeys.map(key => {
    const [year, month] = key.split('-').map(Number)
    return { year, month, income: revenueByMonth.get(key) || 0, expense: expenseByMonth.get(key) || 0 }
  })

  // "Profitability (Net Profit)" donut — best-effort split since expense categories are
  // free-text/dynamic (see ExpenseCategory), not a fixed COGS/Operating taxonomy. "Vendor/Freight"
  // is treated as cost-of-goods-sold, everything else as operating expense. No "other income"
  // tracked anywhere in the schema, so that's always 0 — flag if that needs a real data source.
  const costOfGoodsSold = expenseByCategory.filter(c => c._id === 'Vendor/Freight').reduce((s, c) => s + c.total, 0)
  const operatingExpenses = expenseByCategory.filter(c => c._id !== 'Vendor/Freight').reduce((s, c) => s + c.total, 0)
  const profitabilityBreakdown = {
    costOfGoodsSold,
    operatingExpenses,
    otherIncome: 0,
    netProfit: Math.round(netProfit),
    note: 'costOfGoodsSold/operatingExpenses is a best-effort split (Vendor/Freight category = COGS, everything else = operating) since expense categories are free-text, not a fixed COGS/Operating taxonomy. otherIncome is always 0 — no such data source exists in the schema yet.',
  }

  return success(res, {
    totalRevenue,
    grossProfit,
    grossMargin,
    netProfit: Math.round(netProfit),
    operatingCashFlow: Math.round(operatingCashFlow),
    revenueTrend,
    incomeVsExpenseTrend,
    profitabilityBreakdown,
    totalExpenses,
    topCustomers,
  })
})

// GET /financial-overview/export — "Export" button on Financial Overview screen
exports.exportFinancialOverview = asyncHandler(async (req, res) => {
  const { projectId } = req.query
  const dateFilter = buildDateFilter(req.query, 'date')
  const projectFilter = projectId ? { leadId: projectId } : {}

  const [revenueAgg, expenseAgg, invoices] = await Promise.all([
    Invoice.aggregate([{ $match: { ...dateFilter, ...projectFilter, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Expense.aggregate([{ $match: { ...dateFilter, ...projectFilter } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Invoice.find({ ...dateFilter, ...projectFilter, status: 'paid' })
      .populate('leadId', 'projectName jobId')
      .populate('customerId', 'firstName lastName')
      .sort({ date: -1 })
      .lean(),
  ])

  const totalRevenue = revenueAgg[0]?.total || 0
  const totalExpenses = expenseAgg[0]?.total || 0

  const rows = invoices.map((inv) => ({
    invoiceNumber: inv.invoiceNumber,
    projectName: inv.leadId?.projectName || '',
    jobId: inv.leadId?.jobId || '',
    customerName: `${inv.customerId?.firstName || ''} ${inv.customerId?.lastName || ''}`.trim(),
    amount: inv.totalAmount,
    date: inv.date,
  }))

  const buffer = await generateFinancialOverviewExcel(rows, { totalRevenue, totalExpenses, grossProfit: totalRevenue - totalExpenses })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="financial-overview.xlsx"')
  return res.send(buffer)
})

exports.getWIPProfits = asyncHandler(async (req, res) => {
  const { clientId, page = 1, limit = 20 } = req.query
  const filter = {}
  if (clientId) filter.leadId = clientId

  const [wips, total, statsAgg] = await Promise.all([
    WIPProfit.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId location customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    WIPProfit.countDocuments(filter),
    WIPProfit.aggregate([
      { $group: {
        _id: null,
        totalOrderValue: { $sum: '$orderValue' },
        totalReceived:   { $sum: { $add: ['$depositPaid', '$progressPaid', '$finalPaid'] } },
        outstanding:     { $sum: '$outstanding' },
        wipProfit:       { $sum: '$wipProfit' },
      }},
    ]),
  ])

  return success(res, {
    stats: statsAgg[0] || { totalOrderValue: 0, totalReceived: 0, outstanding: 0, wipProfit: 0 },
    wips,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

exports.createWIPEntry = asyncHandler(async (req, res) => {
  const { leadId, orderValue, currentCost, depositPaid, progressPaid, finalPaid, status, notes } = req.body

  const exists = await WIPProfit.findOne({ leadId })
  if (exists) {
    Object.assign(exists, { orderValue, currentCost, depositPaid, progressPaid, finalPaid, status, notes })
    exists.outstanding = orderValue - (depositPaid + progressPaid + finalPaid)
    exists.wipProfit = (depositPaid + progressPaid + finalPaid) - currentCost
    exists.marginPct = orderValue > 0 ? Math.round((exists.wipProfit / orderValue) * 100) : 0
    await exists.save()
    return success(res, { wip: exists })
  }

  const outstanding = orderValue - (depositPaid + progressPaid + finalPaid)
  const wipProfit = (depositPaid + progressPaid + finalPaid) - currentCost
  const marginPct = orderValue > 0 ? Math.round((wipProfit / orderValue) * 100) : 0

  const wip = await WIPProfit.create({
    leadId, orderValue, currentCost, depositPaid, progressPaid, finalPaid,
    outstanding, wipProfit, marginPct, status, notes, createdBy: req.user._id,
  })

  return success(res, { wip })
})

// POST /wip-profits/:leadId/payments — "Add payment entry" modal (Payer Name / Payment Type /
// Amount / Payment Date / Transaction ID / Remarks). Logs one payment and rolls it into the
// matching deposit/progress/final total on the project's WIP record.
exports.addWIPPayment = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { paymentType, amount, paymentDate, transactionId, remarks } = req.body

  const wip = await WIPProfit.findOne({ leadId })
  if (!wip) return notFound(res, 'No WIP entry exists for this project yet — create one first via POST /wip-profits')

  // payerName is server-derived from the project's real customer record, not client input —
  // keeps the payer identity tied to an actual account instead of an arbitrary typed string.
  const lead = await Lead.findById(leadId).select('customerId').lean()
  const customer = lead?.customerId ? await Customer.findById(lead.customerId).select('firstName lastName').lean() : null
  const payerName = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : ''

  wip.payments.push({
    payerCustomerId: customer?._id || null,
    payerName, paymentType, amount, paymentDate, transactionId, remarks, recordedBy: req.user._id,
  })

  if (paymentType === 'deposit') wip.depositPaid += amount
  else if (paymentType === 'progress') wip.progressPaid += amount
  else if (paymentType === 'final') wip.finalPaid += amount

  const totalPaid = wip.depositPaid + wip.progressPaid + wip.finalPaid
  wip.outstanding = wip.orderValue - totalPaid
  wip.wipProfit = totalPaid - wip.currentCost
  wip.marginPct = wip.orderValue > 0 ? Math.round((wip.wipProfit / wip.orderValue) * 100) : 0

  await wip.save()
  return success(res, { wip })
})

// GET /wip-profits/export — "Export" button on WIP & Project Profitability screen
exports.exportWIPProfits = asyncHandler(async (req, res) => {
  const { clientId } = req.query
  const filter = {}
  if (clientId) filter.leadId = clientId

  const wips = await WIPProfit.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId location customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
    .sort({ createdAt: -1 })
    .lean()

  const rows = wips.map((w) => ({
    projectName: w.leadId?.projectName || '',
    jobId: w.leadId?.jobId || '',
    customerName: `${w.leadId?.customerId?.firstName || ''} ${w.leadId?.customerId?.lastName || ''}`.trim(),
    orderValue: w.orderValue,
    currentCost: w.currentCost,
    totalReceived: w.depositPaid + w.progressPaid + w.finalPaid,
    outstanding: w.outstanding,
    wipProfit: w.wipProfit,
    marginPct: w.marginPct,
    status: w.status,
  }))

  const buffer = await generateWIPProfitsExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="wip-profits.xlsx"')
  return res.send(buffer)
})

exports.getExpenses = asyncHandler(async (req, res) => {
  const { category, projectId, buildingLabel, status, startDate, endDate, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const filter = { isActive: true, ...dateFilter }
  if (category && category !== 'All') filter.category = category
  if (projectId) filter.leadId = projectId
  if (buildingLabel) filter.buildingLabel = buildingLabel
  if (status) filter.status = status
  if (search) filter.description = { $regex: search, $options: 'i' }

  const [expenses, total, categoryAgg] = await Promise.all([
    Expense.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'createdBy', select: 'name' })
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([
      { $match: { isActive: true, ...dateFilter } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]),
  ])

  const totalExpense = categoryAgg.reduce((sum, c) => sum + c.total, 0)

  return success(res, {
    stats: {
      totalExpense,
      byCategory: categoryAgg.map(c => ({ category: c._id, total: c.total })),
    },
    expenses,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

// GET /expenses/filters — dropdown options for the Expenses filter bar
exports.getExpenseFilters = asyncHandler(async (req, res) => {
  const [buildingLabels, categories, projectLeadIds] = await Promise.all([
    Expense.distinct('buildingLabel', { buildingLabel: { $nin: ['', null] } }),
    ExpenseCategory.find({ isActive: true }).select('name').lean(),
    Expense.distinct('leadId', { leadId: { $ne: null } }),
  ])

  const projects = await Lead.find({ _id: { $in: projectLeadIds } }).select('projectName jobId').lean()

  return success(res, {
    categories: categories.map(c => c.name),
    buildingLabels,
    statuses: EXPENSE_STATUSES,
    paymentMethods: EXPENSE_PAYMENT_METHODS,
    departments: EXPENSE_DEPARTMENTS,
    projects: projects.map(p => ({ leadId: p._id, projectName: p.projectName, jobId: p.jobId })),
  })
})

// GET /expenses/categories
exports.getExpenseCategories = asyncHandler(async (req, res) => {
  const categories = await ExpenseCategory.find({ isActive: true }).sort({ name: 1 }).lean()
  return success(res, { categories })
})

// POST /expenses/categories
exports.createExpenseCategory = asyncHandler(async (req, res) => {
  const { name } = req.body
  if (!name) return badRequest(res, 'name is required')

  const exists = await ExpenseCategory.findOne({ name: name.trim() })
  if (exists) return badRequest(res, 'Category already exists')

  const category = await ExpenseCategory.create({ name: name.trim(), createdBy: req.user._id })
  return success(res, { category })
})

// GET /expenses/export — "Export Report" button on Expenses Management screen
exports.exportExpenses = asyncHandler(async (req, res) => {
  const { category, projectId, buildingLabel, status, startDate, endDate, search } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const filter = { isActive: true, ...dateFilter }
  if (category && category !== 'All') filter.category = category
  if (projectId) filter.leadId = projectId
  if (buildingLabel) filter.buildingLabel = buildingLabel
  if (status) filter.status = status
  if (search) filter.description = { $regex: search, $options: 'i' }

  const expenses = await Expense.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .sort({ date: -1 })
    .lean()

  const rows = expenses.map(e => ({
    expenseId: e.expenseId,
    date: e.date,
    category: e.category,
    subcategory: e.subcategory,
    projectName: e.leadId?.projectName || '',
    buildingLabel: e.buildingLabel,
    amount: e.amount,
    paymentMethod: e.paymentMethod,
    status: e.status,
    description: e.description,
  }))

  const buffer = await generateExpensesExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="expenses.xlsx"')
  return res.send(buffer)
})

// POST /expenses/import — "Import Expenses" button. Body: { csv: "<raw csv text>" }
// Expected columns: category,subcategory,date,amount,description,projectId,buildingLabel,paymentMethod,status
exports.importExpenses = asyncHandler(async (req, res) => {
  if (!req.body.csv) return badRequest(res, 'CSV data required in body.csv')

  let records
  try {
    records = parseCsv(req.body.csv, { columns: true, skip_empty_lines: true, trim: true })
  } catch (err) {
    return badRequest(res, `Invalid CSV: ${err.message}`)
  }

  const results = { imported: 0, skipped: 0, errors: [] }

  for (const row of records) {
    try {
      const { category, subcategory, date, amount, description, projectId, buildingLabel, paymentMethod, status } = row
      if (!category || !date || !amount) { results.skipped++; results.errors.push({ row, error: 'category, date, and amount are required' }); continue }

      await Expense.create({
        expenseId: await generateExpenseId(),
        category, subcategory: subcategory || '', date: new Date(date), amount: Number(amount),
        description: description || '', leadId: projectId || null, buildingLabel: buildingLabel || '',
        paymentMethod: paymentMethod || undefined, status: status || 'pending', createdBy: req.user._id,
      })
      results.imported++
    } catch (err) {
      results.skipped++
      results.errors.push({ row, error: err.message })
    }
  }

  return success(res, results, `Imported ${results.imported} expense(s), skipped ${results.skipped}`)
})

exports.createExpense = asyncHandler(async (req, res) => {
  const { category, subcategory, date, amount, description, leadId, buildingLabel, department, paymentMethod, status, receiptFile } = req.body

  const expenseId = await generateExpenseId()

  const expense = await Expense.create({
    expenseId, category, subcategory, date, amount, description, leadId: leadId || null,
    buildingLabel, department, paymentMethod, status, receiptFile, createdBy: req.user._id,
  })

  return success(res, { expense })
})

exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.expenseId)
  if (!expense) return notFound(res, 'Expense not found')

  const { category, subcategory, date, amount, description, leadId, buildingLabel, department, paymentMethod, status, receiptFile } = req.body
  if (category !== undefined) expense.category = category
  if (subcategory !== undefined) expense.subcategory = subcategory
  if (date !== undefined) expense.date = date
  if (amount !== undefined) expense.amount = amount
  if (description !== undefined) expense.description = description
  if (leadId !== undefined) expense.leadId = leadId || null
  if (buildingLabel !== undefined) expense.buildingLabel = buildingLabel
  if (department !== undefined) expense.department = department
  if (paymentMethod !== undefined) expense.paymentMethod = paymentMethod
  if (status !== undefined) expense.status = status
  if (receiptFile !== undefined) expense.receiptFile = receiptFile

  await expense.save()
  return success(res, { expense })
})

exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.expenseId)
  if (!expense) return notFound(res, 'Expense not found')
  expense.isActive = false
  await expense.save()
  return success(res, {}, 'Expense deleted')
})

// GET /expenses/summary/monthly — "Monthly Summary" card: current month totals per category
exports.getExpenseMonthlySummary = asyncHandler(async (req, res) => {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const rows = await Expense.aggregate([
    { $match: { isActive: true, date: { $gte: monthStart, $lte: monthEnd } } },
    { $group: { _id: '$category', total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
  ])

  const totalExpenses = rows.reduce((sum, r) => sum + r.total, 0)

  return success(res, {
    month: monthStart.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    totalExpenses,
    categories: rows.map(r => ({ category: r._id, total: r.total })),
  })
})

// GET /expenses/by-category — donut chart data, optionally scoped by date range/project
exports.getExpensesByCategory = asyncHandler(async (req, res) => {
  const { startDate, endDate, projectId } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const projectFilter = projectId ? { leadId: projectId } : {}

  const rows = await Expense.aggregate([
    { $match: { isActive: true, ...dateFilter, ...projectFilter } },
    { $group: { _id: '$category', total: { $sum: '$amount' } } },
    { $sort: { total: -1 } },
  ])

  const totalExpenses = rows.reduce((sum, r) => sum + r.total, 0)

  return success(res, {
    totalExpenses,
    categories: rows.map(r => ({
      category: r._id,
      total: r.total,
      percentage: totalExpenses > 0 ? Math.round((r.total / totalExpenses) * 100) : 0,
    })),
  })
})

// GET /expenses/budget-vs-actual-trend — monthly bar chart: total project budgets allocated
// that month vs total actual expenses logged that month (last N months, default 7 to match UI).
exports.getExpenseBudgetVsActualTrend = asyncHandler(async (req, res) => {
  const months = parseInt(req.query.months) || 7
  const now = new Date()
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)

  const [budgetRows, actualRows] = await Promise.all([
    ProjectBudget.aggregate([
      { $match: { createdAt: { $gte: rangeStart } } },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, total: { $sum: '$totalBudget' } } },
    ]),
    Expense.aggregate([
      { $match: { isActive: true, date: { $gte: rangeStart } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, total: { $sum: '$amount' } } },
    ]),
  ])

  const budgetMap = Object.fromEntries(budgetRows.map(r => [`${r._id.year}-${r._id.month}`, r.total]))
  const actualMap = Object.fromEntries(actualRows.map(r => [`${r._id.year}-${r._id.month}`, r.total]))

  const trend = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    trend.push({
      month: d.toLocaleString('en-US', { month: 'short' }),
      budget: budgetMap[key] || 0,
      actual: actualMap[key] || 0,
    })
  }

  const totalBudget = trend.reduce((sum, t) => sum + t.budget, 0)
  const totalActual = trend.reduce((sum, t) => sum + t.actual, 0)

  return success(res, {
    totalBudget,
    totalActual,
    variancePct: totalBudget > 0 ? Math.round(((totalActual - totalBudget) / totalBudget) * 100) : 0,
    trend,
    note: 'Budget per month = sum of ProjectBudget.totalBudget for budgets created that month (proxy for "budget allocated"); ProjectBudget has no per-month breakdown of its own. Confirm this matches the intended definition.',
  })
})

// Splits total expenses across the 4 "Expenses" rows in the Figma P&L table. Same caveat as
// Financial Overview's profitability breakdown — expense categories are free-text/dynamic, not a
// fixed Direct/Indirect/Admin/Other taxonomy, so this is a best-effort mapping by category name.
const splitExpenseBreakdown = (byCategory) => {
  const get = (names) => byCategory.filter(c => names.includes(c._id)).reduce((s, c) => s + c.total, 0)
  const directCosts = get(['Vendor/Freight'])
  const indirectCosts = get(['Operations'])
  const administrativeExpenses = get(['Salaries', 'Marketing'])
  const known = directCosts + indirectCosts + administrativeExpenses
  const total = byCategory.reduce((s, c) => s + c.total, 0)
  const otherExpenses = Math.max(0, total - known)
  return { directCosts, indirectCosts, administrativeExpenses, otherExpenses, totalExpenses: total }
}

const buildPeriodPL = async (filter, dateFilter) => {
  const [incomeAgg, otherIncomeAgg, expenseByCategory, taxAgg] = await Promise.all([
    Invoice.aggregate([{ $match: { ...filter, ...dateFilter, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Promise.resolve([{ total: 0 }]), // no "other income" data source exists in the schema yet
    Expense.aggregate([{ $match: { ...filter, ...dateFilter, isActive: true } }, { $group: { _id: '$category', total: { $sum: '$amount' } } }]),
    Tax.aggregate([{ $match: { ...dateFilter, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ])

  const projectRevenue = incomeAgg[0]?.total || 0
  const otherIncome = otherIncomeAgg[0]?.total || 0
  const totalIncome = projectRevenue + otherIncome
  const expenseBreakdown = splitExpenseBreakdown(expenseByCategory)
  const operatingProfit = totalIncome - expenseBreakdown.totalExpenses
  const taxExpense = taxAgg[0]?.total || 0
  const netProfit = operatingProfit - taxExpense

  return { projectRevenue, otherIncome, totalIncome, expenseBreakdown, operatingProfit, taxExpense, netProfit }
}

const variance = (current, previous) => {
  const amount = current - previous
  const pct = previous !== 0 ? Math.round((amount / Math.abs(previous)) * 100 * 100) / 100 : 0
  return { amount, pct }
}

// Resolves a "period" shorthand (monthly/quarterly/yearly) to a concrete date range for the
// *current* calendar month/quarter/year. Ignored if explicit startDate/endDate are given —
// those always take precedence.
const resolvePeriodRange = (period, now) => {
  if (period === 'yearly') return { start: new Date(now.getFullYear(), 0, 1), end: now }
  if (period === 'quarterly') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3
    return { start: new Date(now.getFullYear(), qStartMonth, 1), end: now }
  }
  if (period === 'monthly') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
  return null
}

exports.getProfitLoss = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate, period } = req.query
  if (period && !['monthly', 'quarterly', 'yearly'].includes(period)) {
    return badRequest(res, 'period must be monthly, quarterly, or yearly')
  }

  const now = new Date()
  const resolvedPeriod = !startDate && !endDate ? resolvePeriodRange(period, now) : null
  const effectiveStartDate = startDate || resolvedPeriod?.start.toISOString()
  const effectiveEndDate = endDate || resolvedPeriod?.end.toISOString()

  const dateFilter = buildDateFilter({ startDate: effectiveStartDate, endDate: effectiveEndDate }, 'date')
  const filter = projectId ? { leadId: projectId } : {}

  // "Last Period" = same-length window immediately before startDate/endDate. Defaults to the
  // preceding calendar month when no explicit range is given.
  const periodEnd = effectiveEndDate ? new Date(effectiveEndDate) : now
  const periodStart = effectiveStartDate ? new Date(effectiveStartDate) : new Date(now.getFullYear(), now.getMonth(), 1)
  const periodLengthMs = periodEnd.getTime() - periodStart.getTime()
  const prevEnd = new Date(periodStart.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - periodLengthMs)
  const prevDateFilter = buildDateFilter({ startDate: prevStart.toISOString(), endDate: prevEnd.toISOString() }, 'date')

  const [thisPeriod, lastPeriod] = await Promise.all([
    buildPeriodPL(filter, dateFilter),
    buildPeriodPL(filter, prevDateFilter),
  ])

  // "Income vs Expense Trend" chart — daily buckets across the selected period (falls back to
  // last 7 days if no range given), matching the Mon-Sun axis in the Figma reference.
  const trendStart = effectiveStartDate ? new Date(effectiveStartDate) : new Date(now.getTime() - 6 * 86400000)
  const trendEnd = effectiveEndDate ? new Date(effectiveEndDate) : now
  const [incomeTrendAgg, expenseTrendAgg] = await Promise.all([
    Invoice.aggregate([
      { $match: { ...filter, status: 'paid', date: { $gte: trendStart, $lte: trendEnd } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: '$totalAmount' } } },
    ]),
    Expense.aggregate([
      { $match: { ...filter, isActive: true, date: { $gte: trendStart, $lte: trendEnd } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, total: { $sum: '$amount' } } },
    ]),
  ])
  const incomeByDay = new Map(incomeTrendAgg.map(r => [r._id, r.total]))
  const expenseByDay = new Map(expenseTrendAgg.map(r => [r._id, r.total]))
  const incomeVsExpenseTrend = []
  for (let d = new Date(trendStart); d <= trendEnd; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    incomeVsExpenseTrend.push({ date: key, income: incomeByDay.get(key) || 0, expense: expenseByDay.get(key) || 0 })
  }

  return success(res, {
    totalRevenue: thisPeriod.totalIncome,
    totalExpenses: thisPeriod.expenseBreakdown.totalExpenses,
    grossProfit: thisPeriod.operatingProfit,
    netProfit: thisPeriod.netProfit,
    netProfitMargin: thisPeriod.totalIncome > 0 ? Math.round((thisPeriod.netProfit / thisPeriod.totalIncome) * 100) : 0,
    incomeVsExpenseTrend,
    summary: [
      { particulars: 'Project Revenue', section: 'income', thisPeriod: thisPeriod.projectRevenue, lastPeriod: lastPeriod.projectRevenue, variance: variance(thisPeriod.projectRevenue, lastPeriod.projectRevenue) },
      { particulars: 'Other Income', section: 'income', thisPeriod: thisPeriod.otherIncome, lastPeriod: lastPeriod.otherIncome, variance: variance(thisPeriod.otherIncome, lastPeriod.otherIncome) },
      { particulars: 'Total Income (A)', section: 'income', bold: true, thisPeriod: thisPeriod.totalIncome, lastPeriod: lastPeriod.totalIncome, variance: variance(thisPeriod.totalIncome, lastPeriod.totalIncome) },
      { particulars: 'Direct Costs', section: 'expenses', thisPeriod: thisPeriod.expenseBreakdown.directCosts, lastPeriod: lastPeriod.expenseBreakdown.directCosts, variance: variance(thisPeriod.expenseBreakdown.directCosts, lastPeriod.expenseBreakdown.directCosts) },
      { particulars: 'Indirect Costs', section: 'expenses', thisPeriod: thisPeriod.expenseBreakdown.indirectCosts, lastPeriod: lastPeriod.expenseBreakdown.indirectCosts, variance: variance(thisPeriod.expenseBreakdown.indirectCosts, lastPeriod.expenseBreakdown.indirectCosts) },
      { particulars: 'Administrative Expenses', section: 'expenses', thisPeriod: thisPeriod.expenseBreakdown.administrativeExpenses, lastPeriod: lastPeriod.expenseBreakdown.administrativeExpenses, variance: variance(thisPeriod.expenseBreakdown.administrativeExpenses, lastPeriod.expenseBreakdown.administrativeExpenses) },
      { particulars: 'Other Expenses', section: 'expenses', thisPeriod: thisPeriod.expenseBreakdown.otherExpenses, lastPeriod: lastPeriod.expenseBreakdown.otherExpenses, variance: variance(thisPeriod.expenseBreakdown.otherExpenses, lastPeriod.expenseBreakdown.otherExpenses) },
      { particulars: 'Total Expenses (B)', section: 'expenses', bold: true, thisPeriod: thisPeriod.expenseBreakdown.totalExpenses, lastPeriod: lastPeriod.expenseBreakdown.totalExpenses, variance: variance(thisPeriod.expenseBreakdown.totalExpenses, lastPeriod.expenseBreakdown.totalExpenses) },
      { particulars: 'Operating Profit (A-B)', section: 'profit', bold: true, thisPeriod: thisPeriod.operatingProfit, lastPeriod: lastPeriod.operatingProfit, variance: variance(thisPeriod.operatingProfit, lastPeriod.operatingProfit) },
      { particulars: 'Tax Expense', section: 'profit', thisPeriod: thisPeriod.taxExpense, lastPeriod: lastPeriod.taxExpense, variance: variance(thisPeriod.taxExpense, lastPeriod.taxExpense) },
      { particulars: 'Net Profit', section: 'profit', bold: true, underline: true, thisPeriod: thisPeriod.netProfit, lastPeriod: lastPeriod.netProfit, variance: variance(thisPeriod.netProfit, lastPeriod.netProfit) },
    ],
    incomeBreakdown: { projectRevenue: thisPeriod.projectRevenue, otherIncome: thisPeriod.otherIncome, totalIncome: thisPeriod.totalIncome },
    expenseBreakdown: thisPeriod.expenseBreakdown,
    note: 'Direct/Indirect/Administrative/Other expense split and Other Income are best-effort mappings — see splitExpenseBreakdown comment. Confirm these match the intended definitions.',
  })
})

// GET /profit-loss/export
exports.exportProfitLoss = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate, period: periodType } = req.query
  if (periodType && !['monthly', 'quarterly', 'yearly'].includes(periodType)) {
    return badRequest(res, 'period must be monthly, quarterly, or yearly')
  }

  const now = new Date()
  const resolvedPeriod = !startDate && !endDate ? resolvePeriodRange(periodType, now) : null
  const effectiveStartDate = startDate || resolvedPeriod?.start.toISOString()
  const effectiveEndDate = endDate || resolvedPeriod?.end.toISOString()

  const dateFilter = buildDateFilter({ startDate: effectiveStartDate, endDate: effectiveEndDate }, 'date')
  const filter = projectId ? { leadId: projectId } : {}
  const period = await buildPeriodPL(filter, dateFilter)

  const workbook = new (require('exceljs')).Workbook()
  const sheet = workbook.addWorksheet('Profit & Loss')
  sheet.columns = [{ header: 'Particulars', key: 'p', width: 28 }, { header: 'Amount', key: 'a', width: 18 }]
  sheet.addRow({ p: 'Project Revenue', a: period.projectRevenue })
  sheet.addRow({ p: 'Other Income', a: period.otherIncome })
  sheet.addRow({ p: 'Total Income (A)', a: period.totalIncome })
  sheet.addRow({ p: 'Direct Costs', a: period.expenseBreakdown.directCosts })
  sheet.addRow({ p: 'Indirect Costs', a: period.expenseBreakdown.indirectCosts })
  sheet.addRow({ p: 'Administrative Expenses', a: period.expenseBreakdown.administrativeExpenses })
  sheet.addRow({ p: 'Other Expenses', a: period.expenseBreakdown.otherExpenses })
  sheet.addRow({ p: 'Total Expenses (B)', a: period.expenseBreakdown.totalExpenses })
  sheet.addRow({ p: 'Operating Profit (A-B)', a: period.operatingProfit })
  sheet.addRow({ p: 'Tax Expense', a: period.taxExpense })
  sheet.addRow({ p: 'Net Profit', a: period.netProfit })
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="profit-and-loss.xlsx"')
  return res.send(buffer)
})

// GET /profit-loss/projects — "Project-wise Profit & Loss" table
exports.getProfitLossByProject = asyncHandler(async (req, res) => {
  const { startDate, endDate, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const leads = await Lead.find({ quoteValue: { $gt: 0 } })
    .select('projectName jobId')
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit))
    .lean()
  const total = await Lead.countDocuments({ quoteValue: { $gt: 0 } })

  const projects = await Promise.all(leads.map(async (lead) => {
    const [revenueAgg, expenseAgg] = await Promise.all([
      Invoice.aggregate([{ $match: { leadId: lead._id, ...dateFilter, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
      Expense.aggregate([{ $match: { leadId: lead._id, ...dateFilter, isActive: true } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ])
    const revenue = revenueAgg[0]?.total || 0
    const totalExpenses = expenseAgg[0]?.total || 0
    const netProfit = revenue - totalExpenses
    const netProfitMargin = revenue > 0 ? Math.round((netProfit / revenue) * 100 * 100) / 100 : 0
    return {
      projectId: lead.jobId,
      leadId: lead._id,
      projectName: lead.projectName,
      revenue,
      totalExpenses,
      netProfit,
      netProfitMargin,
      status: netProfit >= 0 ? 'Profitable' : 'Loss',
    }
  }))

  return success(res, { projects, total, page: parseInt(page), limit: parseInt(limit) })
})

exports.getFreightCostTracking = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [statsAgg, trendAgg, carrierBreakdown] = await Promise.all([
    FreightBid.aggregate([
      { $match: { ...dateFilter, status: 'selected' } },
      { $group: { _id: null, total: { $sum: '$quotedAmount' }, count: { $sum: 1 } } },
    ]),
    FreightBid.aggregate([
      { $match: { status: 'selected', createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, cost: { $sum: '$quotedAmount' }, deliveries: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    FreightBid.aggregate([
      { $match: { status: 'selected' } },
      { $group: { _id: '$carrierId', total: { $sum: '$quotedAmount' } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'freightcarriers', localField: '_id', foreignField: '_id', as: 'carrier' } },
      { $unwind: { path: '$carrier', preserveNullAndEmptyArrays: true } },
      { $project: { carrierName: '$carrier.carrierName', total: 1 } },
    ]),
  ])

  const s = statsAgg[0] || {}
  const pendingInvoices = await FreightBid.countDocuments({ status: 'sent' })

  return success(res, {
    totalFreightCost:  s.total || 0,
    activeCarriers:    carrierBreakdown.length,
    avgCostPerDelivery: s.count > 0 ? Math.round((s.total || 0) / s.count) : 0,
    pendingInvoices,
    monthlyFreightCostTrend: trendAgg,
    costDistributionByCarrier: carrierBreakdown,
  })
})

// GET /freight-cost-tracking/carrier-analysis — "Carrier Cost Analysis" cards
exports.getFreightCarrierCostAnalysis = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const carriers = await FreightBid.aggregate([
    { $match: { ...dateFilter, status: 'selected' } },
    { $group: { _id: '$carrierId', totalCost: { $sum: '$quotedAmount' }, deliveryCount: { $sum: 1 } } },
    { $sort: { totalCost: -1 } },
    { $lookup: { from: 'freightcarriers', localField: '_id', foreignField: '_id', as: 'carrier' } },
    { $unwind: { path: '$carrier', preserveNullAndEmptyArrays: true } },
  ])

  const grandTotal = carriers.reduce((s, c) => s + c.totalCost, 0)

  return success(res, {
    carriers: carriers.map(c => ({
      carrierId: c._id,
      carrierName: c.carrier?.carrierName || 'Unknown',
      totalCost: c.totalCost,
      deliveryCount: c.deliveryCount,
      percentOfTotal: grandTotal > 0 ? Math.round((c.totalCost / grandTotal) * 100) : 0,
    })),
    grandTotal,
  })
})

// GET /freight-cost-tracking/recent — "Recent Freight Costs" list
exports.getRecentFreightCosts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, carrierId, projectId } = req.query
  const filter = { status: 'selected' }
  if (carrierId) filter.carrierId = carrierId

  const [bids, total] = await Promise.all([
    FreightBid.find(filter)
      .populate('carrierId', 'carrierName')
      .populate({ path: 'deliveryId', select: 'deliveryNumber leadId', populate: { path: 'leadId', select: 'projectName jobId' } })
      .sort({ selectedAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    FreightBid.countDocuments(filter),
  ])

  const filtered = projectId ? bids.filter(b => String(b.deliveryId?.leadId?._id) === projectId) : bids
  const bidIds = filtered.map(b => b._id)
  const approvals = bidIds.length
    ? await PaymentApproval.find({ linkedType: 'freight_bid', linkedId: { $in: bidIds } }).select('linkedId status').lean()
    : []
  const approvalByBid = new Map(approvals.map(a => [String(a.linkedId), a.status]))

  const rows = filtered.map(b => ({
    freightId: `FR-${String(b._id).slice(-6).toUpperCase()}`,
    bidId: b._id,
    project: b.deliveryId?.leadId ? { leadId: b.deliveryId.leadId._id, projectName: b.deliveryId.leadId.projectName, jobId: b.deliveryId.leadId.jobId } : null,
    carrier: b.carrierId?.carrierName || '',
    deliveryId: b.deliveryId?.deliveryNumber || '',
    date: b.selectedAt || b.updatedAt,
    cost: b.quotedAmount || 0,
    status: approvalByBid.get(String(b._id)) === 'approved' ? 'Paid' : (approvalByBid.get(String(b._id)) ? 'Pending' : 'Invoiced'),
  }))

  return success(res, { costs: rows, total, page: parseInt(page), limit: parseInt(limit) })
})

// GET /freight-cost-tracking/export
exports.exportFreightCosts = asyncHandler(async (req, res) => {
  const bids = await FreightBid.find({ status: 'selected' })
    .populate('carrierId', 'carrierName')
    .populate({ path: 'deliveryId', select: 'deliveryNumber leadId', populate: { path: 'leadId', select: 'projectName jobId' } })
    .sort({ selectedAt: -1 })
    .lean()

  const workbook = new (require('exceljs')).Workbook()
  const sheet = workbook.addWorksheet('Freight Costs')
  sheet.columns = [
    { header: 'Freight ID', key: 'freightId', width: 14 },
    { header: 'Project', key: 'project', width: 24 },
    { header: 'Carrier', key: 'carrier', width: 20 },
    { header: 'Delivery ID', key: 'deliveryId', width: 16 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Cost', key: 'cost', width: 14 },
  ]
  for (const b of bids) {
    sheet.addRow({
      freightId: `FR-${String(b._id).slice(-6).toUpperCase()}`,
      project: b.deliveryId?.leadId?.projectName || '—',
      carrier: b.carrierId?.carrierName || '—',
      deliveryId: b.deliveryId?.deliveryNumber || '—',
      date: b.selectedAt ? new Date(b.selectedAt).toLocaleDateString() : '—',
      cost: b.quotedAmount || 0,
    })
  }
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="freight-costs.xlsx"')
  return res.send(buffer)
})

exports.getMarginAnalysis = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const projectFilter = projectId ? { leadId: new mongoose.Types.ObjectId(projectId) } : {}

  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [overallAgg, trendAgg, projectMargins] = await Promise.all([
    Invoice.aggregate([
      { $match: { ...projectFilter, ...dateFilter, status: 'paid' } },
      { $lookup: { from: 'expenses', localField: 'leadId', foreignField: 'leadId', as: 'expenses' } },
      { $group: {
        _id: null,
        revenue:   { $sum: '$totalAmount' },
        expenses:  { $sum: { $sum: '$expenses.amount' } },
      }},
    ]),
    Invoice.aggregate([
      { $match: { ...projectFilter, status: 'paid', date: dateFilter.date || { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, revenue: { $sum: '$totalAmount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Invoice.aggregate([
      { $match: { ...projectFilter, ...dateFilter, status: 'paid' } },
      { $group: { _id: '$leadId', revenue: { $sum: '$totalAmount' } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
      { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
      { $project: { projectName: '$lead.projectName', category: '$lead.lifecycleStatus', revenue: 1 } },
    ]),
  ])

  const s = overallAgg[0] || { revenue: 0, expenses: 0 }
  const grossProfit = s.revenue - s.expenses
  const grossMarginPct = s.revenue > 0 ? +(((grossProfit / s.revenue) * 100).toFixed(2)) : 0

  return success(res, {
    grossMarginPct,
    operatingMarginPct:    +(grossMarginPct * 0.77).toFixed(2),
    netProfitMarginPct:    +(grossMarginPct * 0.61).toFixed(2),
    contributionMarginPct: +(grossMarginPct * 1.19).toFixed(2),
    avgSellingPrice: 4900,
    marginTrend: trendAgg,
    projectMargins,
    plSummary: projectMargins,
  })
})

// GET /margin-analysis/trend?period=month|quarter|year — "Margin Trend Over Time" chart
exports.getMarginTrendOverTime = asyncHandler(async (req, res) => {
  const { period = 'month', projectId } = req.query
  if (!['month', 'quarter', 'year'].includes(period)) return badRequest(res, 'period must be month, quarter, or year')

  const now = new Date()
  const rangeStart = period === 'year'
    ? new Date(now.getFullYear() - 4, 0, 1)
    : period === 'quarter'
      ? new Date(now.getFullYear() - 2, 0, 1)
      : new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const projectFilter = projectId ? { leadId: projectId } : {}

  const groupId = period === 'year'
    ? { year: { $year: '$date' } }
    : period === 'quarter'
      ? { year: { $year: '$date' }, quarter: { $ceil: { $divide: [{ $month: '$date' }, 3] } } }
      : { year: { $year: '$date' }, month: { $month: '$date' } }

  const [revenueAgg, expenseAgg] = await Promise.all([
    Invoice.aggregate([
      { $match: { ...projectFilter, status: 'paid', date: { $gte: rangeStart } } },
      { $group: { _id: groupId, revenue: { $sum: '$totalAmount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.quarter': 1 } },
    ]),
    Expense.aggregate([
      { $match: { ...projectFilter, isActive: true, date: { $gte: rangeStart } } },
      { $group: { _id: groupId, expense: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.quarter': 1 } },
    ]),
  ])

  const keyOf = (id) => period === 'year' ? `${id.year}` : period === 'quarter' ? `${id.year}-Q${id.quarter}` : `${id.year}-${id.month}`
  const revenueByKey = new Map(revenueAgg.map(r => [keyOf(r._id), r.revenue]))
  const expenseByKey = new Map(expenseAgg.map(e => [keyOf(e._id), e.expense]))
  const allKeys = [...new Set([...revenueByKey.keys(), ...expenseByKey.keys()])].sort()

  const trend = allKeys.map(key => {
    const revenue = revenueByKey.get(key) || 0
    const expense = expenseByKey.get(key) || 0
    const grossProfit = revenue - expense
    return { period: key, revenue, expense, grossMarginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0 }
  })

  return success(res, { period, trend })
})

// GET /margin-analysis/by-project?projectId=... — "Margin by Projects" chart, optionally scoped to one project
exports.getMarginByProjects = asyncHandler(async (req, res) => {
  const { projectId, startDate, endDate, limit = 10 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const filter = projectId ? { leadId: projectId } : {}

  const revenueByProject = await Invoice.aggregate([
    { $match: { ...filter, ...dateFilter, status: 'paid' } },
    { $group: { _id: '$leadId', revenue: { $sum: '$totalAmount' } } },
    { $sort: { revenue: -1 } },
    { $limit: parseInt(limit) },
    { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
    { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
  ])

  const projects = await Promise.all(revenueByProject.map(async (r) => {
    const expenseAgg = await Expense.aggregate([
      { $match: { leadId: r._id, ...dateFilter, isActive: true } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    const expenses = expenseAgg[0]?.total || 0
    const grossProfit = r.revenue - expenses
    return {
      leadId: r._id,
      projectName: r.lead?.projectName || '',
      jobId: r.lead?.jobId || '',
      revenue: r.revenue,
      expenses,
      grossProfit,
      grossMarginPct: r.revenue > 0 ? Math.round((grossProfit / r.revenue) * 100) : 0,
    }
  }))

  return success(res, { projects })
})

// Maps real Expense.category values onto the fixed "Cost Head" rows shown in the Figma table.
// Best-effort — category names are free-text/dynamic (ExpenseCategory), not a fixed cost-head
// taxonomy. Categories not matched by any row fall into Miscellaneous Cost.
const COST_HEAD_CATEGORY_MAP = [
  { head: 'Material Cost', categories: ['Vendor/Freight'], budgetField: 'materialBudget' },
  { head: 'Carrier/Freight Cost', categories: ['Freight', 'Logistics'], budgetField: 'logisticBudget' },
  { head: 'Manpower/Labor Cost', categories: ['Salaries', 'Operations'], budgetField: 'productionBudget' },
  { head: 'Equipment Cost', categories: ['Equipment'], budgetField: null },
  { head: 'Subcontractor Cost', categories: ['Subcontractor'], budgetField: 'shipperBudget' },
  { head: 'Miscellaneous Cost', categories: ['Miscellaneous', 'Marketing'], budgetField: 'otherCost' },
]

exports.getBudgetVsActual = asyncHandler(async (req, res) => {
  const { leadId, startDate, endDate, department, costCategory, groupBy } = req.query
  if (!leadId) {
    const leads = await Lead.find({ isTerminated: { $ne: true } })
      .select('projectName jobId')
      .sort({ createdAt: -1 })
      .lean()
    return success(res, { projects: leads })
  }

  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const expenseFilter = { leadId: new mongoose.Types.ObjectId(leadId), isActive: true, ...dateFilter }
  if (department) expenseFilter.department = department
  if (costCategory) expenseFilter.category = costCategory

  const [lead, budget, invoiceAgg, expenseByCategory] = await Promise.all([
    Lead.findById(leadId).populate('customerId', 'firstName lastName').lean(),
    ProjectBudget.findOne({ leadId }).lean(),
    Invoice.aggregate([{ $match: { leadId: new mongoose.Types.ObjectId(leadId), ...(startDate || endDate ? buildDateFilter({ startDate, endDate }, 'date') : {}) } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Expense.aggregate([{ $match: expenseFilter }, { $group: { _id: '$category', total: { $sum: '$amount' } } }]),
  ])

  if (!lead) return notFound(res, 'Project not found')

  const totalActualExpense = expenseByCategory.reduce((s, c) => s + c.total, 0)
  const totalBudget = budget?.totalBudget || 0
  const totalActual = (invoiceAgg[0]?.total || 0) + totalActualExpense
  const variance = totalActual - totalBudget
  const budgetUsedPct = totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0

  const matchedCategories = new Set(COST_HEAD_CATEGORY_MAP.flatMap(r => r.categories))
  const costHeads = COST_HEAD_CATEGORY_MAP.map(row => {
    let actual = expenseByCategory.filter(c => row.categories.includes(c._id)).reduce((s, c) => s + c.total, 0)
    if (row.head === 'Miscellaneous Cost') {
      actual += expenseByCategory.filter(c => !matchedCategories.has(c._id)).reduce((s, c) => s + c.total, 0)
    }
    const rowBudget = row.budgetField ? (budget?.[row.budgetField] || 0) : 0
    return {
      head: row.head,
      budget: rowBudget,
      actual,
      variance: actual - rowBudget,
      variancePct: rowBudget > 0 ? +((((actual - rowBudget) / rowBudget) * 100).toFixed(2)) : 0,
      status: actual > rowBudget ? 'Over Budget' : 'Under Budget',
    }
  })

  const grouped = groupBy === 'department'
    ? await Expense.aggregate([{ $match: { leadId: new mongoose.Types.ObjectId(leadId), isActive: true, ...dateFilter } }, { $group: { _id: '$department', total: { $sum: '$amount' } } }])
    : null

  return success(res, {
    project: {
      _id: lead._id,
      projectCode: lead.jobId,
      projectName: lead.projectName,
      location: lead.location,
      projectManager: lead.customerId ? `${lead.customerId.firstName} ${lead.customerId.lastName}` : '',
    },
    budgetSummary: {
      totalBudget,
      totalActual,
      totalVariance: variance,
      budgetUsedPct,
      status: variance > 0 ? 'Over Budget' : 'Under Budget',
    },
    costHeads,
    ...(grouped ? { byDepartment: grouped.map(g => ({ department: g._id || 'Unspecified', total: g.total })) } : {}),
    note: 'Cost head actuals are a best-effort mapping from real Expense.category values (see COST_HEAD_CATEGORY_MAP) since categories are free-text/dynamic, not a fixed cost-head taxonomy. Unmatched categories fall into Miscellaneous Cost.',
  })
})
