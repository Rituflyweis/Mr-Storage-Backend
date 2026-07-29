const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Vendor = require('../../models/Vendor')
const DeliveryCompany = require('../../models/DeliveryCompany')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const Expense = require('../../models/Expense')
const ProjectBudget = require('../../models/ProjectBudget')
const PaymentApproval = require('../../models/PaymentApproval')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// ── Delivery Finance (dashboard card) ────────────────────────────────────────

exports.getDeliveryFinance = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const [selectedBids, pendingApprovals] = await Promise.all([
    FreightBid.find({ ...dateFilter, status: 'selected' }).select('quotedAmount submissionHistory').lean(),
    PaymentApproval.aggregate([
      { $match: { payeeType: { $in: ['carrier', 'delivery_company'] }, status: { $in: ['pending', 'under_review'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])

  const freightSpend = selectedBids.reduce((s, b) => s + (b.quotedAmount || 0), 0)
  const freightSavings = selectedBids.reduce((s, b) => {
    const original = b.submissionHistory?.[0]?.quotedAmount
    if (original == null || b.quotedAmount == null) return s
    return s + Math.max(0, original - b.quotedAmount)
  }, 0)

  return success(res, {
    freightSpend: round2(freightSpend),
    pendingCarrierPayments: round2(pendingApprovals[0]?.total || 0),
    freightSavings: round2(freightSavings),
  })
})

// ── Freight Costs Overview ───────────────────────────────────────────────────

exports.getFreightCostsOverview = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [statsAgg, trendAgg, carrierBreakdown, carrierCards, recent] = await Promise.all([
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
      { $limit: 8 },
      { $lookup: { from: 'freightcarriers', localField: '_id', foreignField: '_id', as: 'carrier' } },
      { $unwind: { path: '$carrier', preserveNullAndEmptyArrays: true } },
      { $project: { carrierName: '$carrier.carrierName', total: 1 } },
    ]),
    FreightBid.aggregate([
      { $match: { status: 'selected' } },
      { $group: { _id: '$carrierId', totalCost: { $sum: '$quotedAmount' } } },
      { $sort: { totalCost: -1 } },
      { $limit: 4 },
      { $lookup: { from: 'freightcarriers', localField: '_id', foreignField: '_id', as: 'carrier' } },
      { $unwind: { path: '$carrier', preserveNullAndEmptyArrays: true } },
    ]),
    FreightBid.find({ status: 'selected' })
      .select('quotedAmount selectedAt carrierId deliveryId')
      .populate('carrierId', 'carrierName')
      .populate({ path: 'deliveryId', select: 'deliveryNumber leadId', populate: { path: 'leadId', select: 'projectName jobId' } })
      .sort({ selectedAt: -1 })
      .limit(10)
      .lean(),
  ])

  const s = statsAgg[0] || {}
  const totalFreightCost = s.total || 0
  const pendingInvoices = await FreightBid.countDocuments({ status: 'sent' })

  const carrierCardTotal = carrierCards.reduce((sum, c) => sum + (c.totalCost || 0), 0)
  const carrierCostAnalysis = carrierCards.map((c) => ({
    carrierName: c.carrier?.carrierName || 'Unknown',
    totalCost: round2(c.totalCost),
    percentOfTotal: carrierCardTotal > 0 ? Math.round((c.totalCost / carrierCardTotal) * 100) : 0,
  }))

  const recentFreightCosts = recent.map((r) => ({
    freightId: r._id,
    project: r.deliveryId?.leadId?.projectName || '',
    carrier: r.carrierId?.carrierName || '',
    deliveryId: r.deliveryId?._id || null,
    deliveryNumber: r.deliveryId?.deliveryNumber || '',
    date: r.selectedAt,
    cost: round2(r.quotedAmount),
    status: 'invoiced',
  }))

  return success(res, {
    totalFreightCost: round2(totalFreightCost),
    activeCarriers: carrierBreakdown.length,
    avgCostPerDelivery: s.count > 0 ? Math.round(totalFreightCost / s.count) : 0,
    pendingInvoices,
    monthlyFreightCostTrend: trendAgg,
    costDistributionByCarrier: carrierBreakdown,
    carrierCostAnalysis,
    recentFreightCosts,
  })
})

// ── Logistics Costs ───────────────────────────────────────────────────────────

exports.getLogisticsCosts = asyncHandler(async (req, res) => {
  const { carrier, deliveryCompany, project, status, paymentStatus, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = { payeeType: { $in: ['carrier', 'delivery_company'] } }
  if (status) filter.status = status
  if (project) filter.leadId = project

  const [rows, total, statsAgg] = await Promise.all([
    PaymentApproval.find(filter)
      .populate('leadId', 'projectName jobId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PaymentApproval.countDocuments(filter),
    PaymentApproval.aggregate([
      { $match: { payeeType: { $in: ['carrier', 'delivery_company'] } } },
      { $group: {
        _id: null,
        totalCost: { $sum: '$amount' },
        totalPending: { $sum: { $cond: [{ $in: ['$status', ['pending', 'under_review']] }, '$amount', 0] } },
        disputedCount: { $sum: { $cond: [{ $eq: ['$status', 'disputed'] }, 1, 0] } },
        pendingCount: { $sum: { $cond: [{ $in: ['$status', ['pending', 'under_review']] }, 1, 0] } },
      }},
    ]),
  ])

  const s = statsAgg[0] || {}

  const freightAndDeliveryCosts = rows.map((r) => ({
    freightRequest: r.paymentId,
    loadId: r.invoiceNumber || '',
    project: r.leadId?.projectName || '',
    deliveryId: r.linkedId,
    carrier: r.payeeType === 'carrier' ? r.payee : '',
    deliveryCompany: r.payeeType === 'delivery_company' ? r.payee : '',
    amount: round2(r.amount),
    status: r.status,
  }))

  return success(res, {
    totalLogisticsCost: round2(s.totalCost),
    totalSavings: 0,
    pendingInvoices: s.pendingCount || 0,
    disputedItems: s.disputedCount || 0,
    freightAndDeliveryCosts,
    total,
    page: Number(page),
    limit: Number(limit),
  })
})

// ── Cost Variance Analysis (aggregated across all projects) ─────────────────

exports.getCostVarianceAnalysis = asyncHandler(async (req, res) => {
  const { project, status } = req.query

  const budgetFilter = project ? { leadId: project } : {}
  const budgets = await ProjectBudget.find(budgetFilter).populate('leadId', 'projectName jobId').lean()

  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const rows = await Promise.all(budgets.map(async (b) => {
    const expenseAgg = await Expense.aggregate([
      { $match: { leadId: b.leadId?._id, isActive: true } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    const actual = expenseAgg[0]?.total || 0
    const awarded = b.logisticBudget || 0
    const variance = actual - awarded
    const variancePct = awarded > 0 ? +(((variance / awarded) * 100).toFixed(2)) : 0

    return {
      project: b.leadId?.projectName || '',
      jobId: b.leadId?.jobId || '',
      description: 'Logistics cost',
      vendor: '',
      awardedAmount: round2(awarded),
      actualInvoice: round2(actual),
      variance: round2(variance),
      variancePct,
      status: variance > 0 ? 'Over Budget' : variance < 0 ? 'Under Budget' : 'On Budget',
    }
  }))

  const filteredRows = status ? rows.filter((r) => r.status.toLowerCase().replace(' ', '_') === status) : rows

  const netVariance = rows.reduce((s, r) => s + r.variance, 0)
  const overBudget = rows.filter((r) => r.status === 'Over Budget').length
  const underBudget = rows.filter((r) => r.status === 'Under Budget').length
  const onBudget = rows.filter((r) => r.status === 'On Budget').length

  const highVarianceAlerts = rows
    .filter((r) => Math.abs(r.variancePct) >= 5)
    .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
    .slice(0, 5)

  const trend = await Expense.aggregate([
    { $match: { isActive: true, date: { $gte: sixMonthsAgo } } },
    { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, actual: { $sum: '$amount' } } },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ])

  return success(res, {
    stats: {
      netVariance: round2(netVariance),
      overBudget,
      underBudget,
      onBudget,
    },
    highVarianceAlerts,
    awardedVsActualTrend: trend,
    varianceDetails: filteredRows,
  })
})

// ── Awarded Freight Loads ─────────────────────────────────────────────────────

exports.getAwardedFreightLoads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const [bids, total] = await Promise.all([
    FreightBid.find({ status: 'selected' })
      .populate('carrierId', 'carrierName contactName phone fleetCapacity')
      .populate({ path: 'deliveryId', select: 'deliveryNumber loadWeight pickupLocation deliveryLocation pickupDate deliveryDate leadId', populate: { path: 'leadId', select: 'projectName jobId' } })
      .sort({ selectedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    FreightBid.countDocuments({ status: 'selected' }),
  ])

  const now = new Date()
  const loads = bids.map((b) => {
    const originalAmount = b.submissionHistory?.[0]?.quotedAmount ?? b.quotedAmount
    const awardedAmount = b.quotedAmount || 0
    const savings = Math.max(0, (originalAmount || 0) - awardedAmount)
    const delivery = b.deliveryId

    return {
      bidId: b._id,
      title: delivery?.loadDescription || 'Freight Load',
      status: delivery?.deliveryDate && new Date(delivery.deliveryDate) > now ? 'Scheduled' : 'In Transit',
      project: {
        leadId: delivery?.leadId?._id,
        projectName: delivery?.leadId?.projectName || '',
        jobId: delivery?.leadId?.jobId || '',
      },
      carrier: {
        carrierId: b.carrierId?._id,
        carrierName: b.carrierId?.carrierName || '',
        weight: delivery?.loadWeight || null,
        distance: null,
      },
      schedule: {
        pickupDate: delivery?.pickupDate,
        deliveryDate: delivery?.deliveryDate,
        deliveryId: delivery?._id,
        deliveryNumber: delivery?.deliveryNumber || '',
      },
      bidDetails: {
        originalBidAmount: round2(originalAmount),
        awardedAmount: round2(awardedAmount),
        savings: round2(savings),
      },
    }
  })

  const summaryAgg = await FreightBid.aggregate([
    { $match: { status: 'selected' } },
    { $group: { _id: null, totalAwarded: { $sum: '$quotedAmount' }, count: { $sum: 1 } } },
  ])
  const activeLoads = await FreightBid.countDocuments({
    status: 'selected',
    deliveryId: { $in: (await Delivery.find({ status: { $nin: ['delivered', 'cancelled'] } }).distinct('_id')) },
  })
  const totalSavings = loads.reduce((s, l) => s + l.bidDetails.savings, 0)

  return success(res, {
    stats: {
      totalAwarded: round2(summaryAgg[0]?.totalAwarded || 0),
      totalLoads: summaryAgg[0]?.count || 0,
      activeLoads,
      totalSavings: round2(totalSavings),
    },
    loads,
    total,
    page: Number(page),
    limit: Number(limit),
  })
})

// ── Project-level Financial Summary ──────────────────────────────────────────

exports.getProjectFinancialSummary = asyncHandler(async (req, res) => {
  const { leadId } = req.query
  if (!leadId) {
    const leads = await Lead.find({ isTerminated: { $ne: true } }).select('projectName jobId').sort({ createdAt: -1 }).lean()
    return success(res, { projects: leads })
  }

  const lead = await Lead.findById(leadId).populate('customerId', 'firstName lastName companyName').lean()
  if (!lead) return notFound(res, 'Project not found')

  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [expenses, freightBids, budget, trend] = await Promise.all([
    Expense.find({ leadId, isActive: true }).lean(),
    FreightBid.find({ status: 'selected' }).populate({ path: 'deliveryId', match: { leadId }, select: 'leadId' }).lean(),
    ProjectBudget.findOne({ leadId }).lean(),
    Expense.aggregate([
      { $match: { leadId: lead._id, isActive: true, date: { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, cost: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ])

  const relevantBids = freightBids.filter((b) => b.deliveryId)
  const totalFreightCost = relevantBids.reduce((s, b) => s + (b.quotedAmount || 0), 0)
  const totalVendorCost = expenses.filter((e) => ['materials', 'subcontractor'].includes(e.category)).reduce((s, e) => s + e.amount, 0)
  const totalDeliveryCost = expenses.filter((e) => e.category === 'transport').reduce((s, e) => s + e.amount, 0) + totalFreightCost * 0 // freight tracked separately
  const totalLogisticsCost = totalFreightCost + totalVendorCost + totalDeliveryCost

  const totalBudget = budget?.totalBudget || 0
  const savingsFromBidding = relevantBids.reduce((s, b) => {
    const original = b.submissionHistory?.[0]?.quotedAmount
    return original != null ? s + Math.max(0, original - (b.quotedAmount || 0)) : s
  }, 0)
  const costOverrun = totalBudget > 0 ? Math.max(0, totalLogisticsCost - totalBudget) : 0

  const costDistribution = [
    { type: 'Freight', amount: round2(totalFreightCost) },
    { type: 'Vendor', amount: round2(totalVendorCost) },
    { type: 'Delivery', amount: round2(totalDeliveryCost) },
  ]

  const costBreakdown = [
    ...relevantBids.map((b) => ({ type: 'Freight', referenceId: String(b._id), company: '', amount: round2(b.quotedAmount), date: b.selectedAt, status: 'Completed', paymentStatus: 'Paid' })),
    ...expenses.slice(0, 20).map((e) => ({ type: e.category, referenceId: e.expenseId, company: '', amount: round2(e.amount), date: e.date, status: 'Completed', paymentStatus: 'Paid' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  return success(res, {
    project: {
      leadId: lead._id,
      projectName: lead.projectName,
      jobId: lead.jobId,
      client: lead.customerId ? `${lead.customerId.firstName || ''} ${lead.customerId.lastName || ''}`.trim() : '',
    },
    summary: {
      totalFreightCost: round2(totalFreightCost),
      totalVendorCost: round2(totalVendorCost),
      totalDeliveryCost: round2(totalDeliveryCost),
      totalLogisticsCost: round2(totalLogisticsCost),
      savingsFromBidding: round2(savingsFromBidding),
      costOverrun: round2(costOverrun),
    },
    costDistributionByType: costDistribution,
    costTrendOverTime: trend,
    costBreakdown,
    monthlyCostComparison: trend,
  })
})

// ── Payment Approvals (account-scoped, 4-state workflow) ────────────────────

exports.getPaymentApprovals = asyncHandler(async (req, res) => {
  const { status, payeeType, search, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = {}
  if (status) filter.status = status
  if (payeeType) filter.payeeType = payeeType
  if (search) filter.$or = [{ payee: { $regex: search, $options: 'i' } }, { invoiceNumber: { $regex: search, $options: 'i' } }]

  const [approvals, total, statsAgg] = await Promise.all([
    PaymentApproval.find(filter)
      .populate('requestedBy', 'name')
      .populate('leadId', 'projectName jobId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    PaymentApproval.countDocuments(filter),
    PaymentApproval.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ])

  const statMap = { pending: 0, under_review: 0, approved: 0, disputed: 0, rejected: 0 }
  statsAgg.forEach((s) => { statMap[s._id] = s.count })

  return success(res, {
    stats: {
      pendingApproval: statMap.pending,
      underReview: statMap.under_review,
      approved: statMap.approved,
      disputed: statMap.disputed,
    },
    approvals: approvals.map((a) => ({
      approvalId: a._id,
      invoiceType: a.payeeType,
      companyName: a.payee,
      invoiceNumber: a.invoiceNumber,
      project: a.leadId ? { leadId: a.leadId._id, projectName: a.leadId.projectName, jobId: a.leadId.jobId } : null,
      amount: round2(a.amount),
      dueDate: a.dueDate,
      linkedType: a.linkedType,
      linkedId: a.linkedId,
      status: a.status,
    })),
    total,
    page: Number(page),
    limit: Number(limit),
  })
})

exports.reviewPaymentApproval = asyncHandler(async (req, res) => {
  const { action, reviewNotes } = req.body
  if (!['under_review', 'approved', 'disputed', 'rejected'].includes(action)) return badRequest(res, 'Invalid action')

  const approval = await PaymentApproval.findById(req.params.approvalId)
  if (!approval) return notFound(res, 'Payment approval not found')

  approval.status = action
  approval.reviewedBy = req.user._id
  approval.reviewedAt = new Date()
  if (reviewNotes !== undefined) approval.reviewNotes = reviewNotes
  if (action === 'approved') approval.paidAt = new Date()
  await approval.save()

  return success(res, { approval }, `Payment marked ${action.replace('_', ' ')}`)
})

// ── Payment Status Dashboard (Vendor/Carrier) ────────────────────────────────

exports.getPaymentStatusDashboard = asyncHandler(async (req, res) => {
  const { search, type, status, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = {}
  if (type) filter.payeeType = type
  if (status) filter.status = status
  if (search) filter.$or = [{ payee: { $regex: search, $options: 'i' } }, { invoiceNumber: { $regex: search, $options: 'i' } }]

  const now = new Date()
  const in30Days = new Date(now.getTime() + 30 * 86400000)

  const [rows, total, statsAgg, overdue, dueSoon] = await Promise.all([
    PaymentApproval.find(filter).populate('leadId', 'projectName').sort({ dueDate: 1 }).skip(skip).limit(Number(limit)).lean(),
    PaymentApproval.countDocuments(filter),
    PaymentApproval.aggregate([
      { $group: {
        _id: null,
        totalOutstanding: { $sum: { $cond: [{ $ne: ['$status', 'approved'] }, '$amount', 0] } },
        totalPaid: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] } },
        vendorPaid: { $sum: { $cond: [{ $and: [{ $eq: ['$payeeType', 'vendor'] }, { $eq: ['$status', 'approved'] }] }, '$amount', 0] } },
        carrierPaid: { $sum: { $cond: [{ $and: [{ $eq: ['$payeeType', 'carrier'] }, { $eq: ['$status', 'approved'] }] }, '$amount', 0] } },
      }},
    ]),
    PaymentApproval.find({ dueDate: { $lt: now }, status: { $ne: 'approved' } }).sort({ dueDate: 1 }).limit(5).lean(),
    PaymentApproval.find({ dueDate: { $gte: now, $lte: in30Days }, status: { $ne: 'approved' } }).sort({ dueDate: 1 }).limit(5).lean(),
  ])

  const s = statsAgg[0] || {}

  return success(res, {
    stats: {
      totalOutstanding: round2(s.totalOutstanding),
      totalPaid: round2(s.totalPaid),
      vendorPayments: round2(s.vendorPaid),
      carrierPayments: round2(s.carrierPaid),
    },
    overduePayments: overdue.map((r) => ({ entity: r.payee, amount: round2(r.amount), dueDate: r.dueDate, invoiceNumber: r.invoiceNumber })),
    dueSoon: dueSoon.map((r) => ({ entity: r.payee, amount: round2(r.amount), dueDate: r.dueDate, invoiceNumber: r.invoiceNumber })),
    paymentHistory: rows.map((r) => ({
      entity: r.payee,
      type: r.payeeType,
      invoiceNumber: r.invoiceNumber,
      amount: round2(r.amount),
      dueDate: r.dueDate,
      paymentDate: r.paidAt,
      status: r.status,
      project: r.leadId?.projectName || '',
    })),
    total,
    page: Number(page),
    limit: Number(limit),
  })
})

// ── Invoice Management: Vendor / Carrier / Delivery Company sub-tabs ────────

const buildInvoiceManagementTab = async (payeeType, query) => {
  const { search, status, page = 1, limit = 20 } = query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = { payeeType }
  if (status) filter.status = status
  if (search) filter.$or = [{ payee: { $regex: search, $options: 'i' } }, { invoiceNumber: { $regex: search, $options: 'i' } }]

  const [rows, total, statsAgg] = await Promise.all([
    PaymentApproval.find(filter).populate('leadId', 'projectName jobId').sort({ dueDate: 1 }).skip(skip).limit(Number(limit)).lean(),
    PaymentApproval.countDocuments(filter),
    PaymentApproval.aggregate([
      { $match: { payeeType } },
      { $group: { _id: null, total: { $sum: '$amount' }, pending: { $sum: { $cond: [{ $ne: ['$status', 'approved'] }, '$amount', 0] } }, paid: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] } } } },
    ]),
  ])

  const s = statsAgg[0] || {}

  return {
    stats: { totalPayable: round2(s.total), pendingAmount: round2(s.pending), paidAmount: round2(s.paid) },
    invoices: rows.map((r) => ({
      invoiceId: r._id,
      invoiceNumber: r.invoiceNumber,
      name: r.payee,
      project: r.leadId?.projectName || '',
      amount: round2(r.amount),
      dueDate: r.dueDate,
      status: r.status,
    })),
    total,
    page: Number(page),
    limit: Number(limit),
  }
}

exports.getVendorInvoices = asyncHandler(async (req, res) => success(res, await buildInvoiceManagementTab('vendor', req.query)))
exports.getCarrierInvoices = asyncHandler(async (req, res) => success(res, await buildInvoiceManagementTab('carrier', req.query)))
exports.getDeliveryCompanyInvoices = asyncHandler(async (req, res) => success(res, await buildInvoiceManagementTab('delivery_company', req.query)))

// ── Analytics -> Reporting ────────────────────────────────────────────────────

exports.getAnalyticsReporting = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [selectedBids, deliveries, trend, projectCosts] = await Promise.all([
    FreightBid.find({ ...dateFilter, status: 'selected' }).select('quotedAmount submissionHistory deliveryId').populate({ path: 'deliveryId', select: 'leadId', populate: { path: 'leadId', select: 'projectName' } }).lean(),
    Delivery.countDocuments(dateFilter),
    FreightBid.aggregate([
      { $match: { status: 'selected', createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        originalQuote: { $sum: { $arrayElemAt: ['$submissionHistory.quotedAmount', 0] } },
        awardedAmount: { $sum: '$quotedAmount' },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    FreightBid.aggregate([
      { $match: { status: 'selected' } },
      { $lookup: { from: 'deliveries', localField: 'deliveryId', foreignField: '_id', as: 'delivery' } },
      { $unwind: { path: '$delivery', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'leads', localField: 'delivery.leadId', foreignField: '_id', as: 'lead' } },
      { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$lead._id', projectName: { $first: '$lead.projectName' }, total: { $sum: '$quotedAmount' }, deliveries: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 10 },
    ]),
  ])

  const totalFreightSavings = selectedBids.reduce((s, b) => {
    const original = b.submissionHistory?.[0]?.quotedAmount
    return original != null ? s + Math.max(0, original - (b.quotedAmount || 0)) : s
  }, 0)
  const projectFreightCosts = selectedBids.reduce((s, b) => s + (b.quotedAmount || 0), 0)
  const avgSavingsPct = projectFreightCosts > 0 ? +(((totalFreightSavings / (projectFreightCosts + totalFreightSavings)) * 100).toFixed(1)) : 0

  return success(res, {
    stats: {
      totalFreightSavings: round2(totalFreightSavings),
      avgSavingsPct,
      projectFreightCosts: round2(projectFreightCosts),
      deliverySpend: round2(projectFreightCosts),
      totalDeliveries: deliveries,
    },
    freightSavingsReport: trend.map((t) => ({ ...t, savings: round2((t.originalQuote || 0) - (t.awardedAmount || 0)) })),
    projectFreightCostSummary: projectCosts.map((p) => ({ projectName: p.projectName, total: round2(p.total), deliveries: p.deliveries, costPerDelivery: p.deliveries > 0 ? round2(p.total / p.deliveries) : 0 })),
    monthlyCostTrendAnalysis: trend,
  })
})

// ── Master Data (read-only directories) ──────────────────────────────────────

exports.getMasterDataVendors = asyncHandler(async (req, res) => {
  const { search, status } = req.query
  const filter = {}
  if (status) filter.status = status
  if (search) filter.$or = [{ vendorName: { $regex: search, $options: 'i' } }, { serviceCategory: { $regex: search, $options: 'i' } }]

  const vendors = await Vendor.find(filter).sort({ vendorName: 1 }).lean()
  return success(res, {
    vendors: vendors.map((v) => ({
      vendorId: v._id,
      vendorCode: v.vendorCode,
      name: v.vendorName,
      category: v.serviceCategory,
      phone: v.phone,
      email: v.email,
      address: v.address,
      contactName: v.contactName,
      status: v.status,
    })),
    total: vendors.length,
  })
})

exports.getMasterDataCarriers = asyncHandler(async (req, res) => {
  const { search, status } = req.query
  const filter = {}
  if (status) filter.status = status
  if (search) filter.$or = [{ carrierName: { $regex: search, $options: 'i' } }, { serviceType: { $regex: search, $options: 'i' } }]

  const carriers = await FreightCarrier.find(filter).sort({ carrierName: 1 }).lean()
  return success(res, {
    carriers: carriers.map((c) => ({
      carrierId: c._id,
      carrierCode: c.carrierCode,
      name: c.carrierName,
      category: c.serviceType,
      phone: c.phone,
      email: c.email,
      address: c.address,
      contactName: c.contactName,
      status: c.status,
    })),
    total: carriers.length,
  })
})

exports.getMasterDataDeliveryCompanies = asyncHandler(async (req, res) => {
  const { search, status } = req.query
  const filter = {}
  if (status) filter.status = status
  if (search) filter.$or = [{ companyName: { $regex: search, $options: 'i' } }, { serviceType: { $regex: search, $options: 'i' } }]

  const companies = await DeliveryCompany.find(filter).sort({ companyName: 1 }).lean()
  return success(res, {
    deliveryCompanies: companies.map((c) => ({
      companyId: c._id,
      companyCode: c.companyCode,
      name: c.companyName,
      category: c.serviceType,
      phone: c.phone,
      email: c.email,
      address: c.address,
      contactName: c.contactName,
      status: c.status,
    })),
    total: companies.length,
  })
})
