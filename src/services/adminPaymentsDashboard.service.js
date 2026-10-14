const Invoice = require('../models/Invoice')
const PaymentSchedule = require('../models/PaymentSchedule')
const { buildDateFilter } = require('../utils/dateRange')

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Pending',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

/** Customer receivable invoices only (exclude vendor / freight payables). */
const buildCustomerInvoiceMatch = (dateFilter = {}) => ({
  ...dateFilter,
  $or: [
    { invoiceType: 'customer' },
    { invoiceType: { $exists: false } },
    { invoiceType: null },
  ],
})

const invoiceDueDateAddFields = {
  effectiveDue: {
    $ifNull: [
      '$dueDate',
      { $add: ['$date', { $multiply: [{ $ifNull: ['$daysToPay', 0] }, 86400000] }] },
    ],
  },
}

const mapRecentPaymentRow = (inv) => {
  const customerName = `${inv.customerId?.firstName || ''} ${inv.customerId?.lastName || ''}`.trim()
  const projectName = inv.leadId?.projectName || ''
  const received =
    inv.status === 'paid'
      ? inv.totalAmount || 0
      : inv.paymentProof?.status === 'approved' && inv.paymentProof?.amount
        ? inv.paymentProof.amount
        : 0

  return {
    id: inv._id,
    date: inv.paidAt || inv.paymentProof?.paymentDate || inv.createdAt,
    clientName: customerName,
    projectName,
    clientProjectLabel: [customerName, projectName].filter(Boolean).join(', '),
    invoiceNumber: inv.invoiceNumber,
    amount: inv.totalAmount || 0,
    received,
    paymentMode: inv.paymentMethod || 'N/A',
    status: inv.status,
    statusLabel: STATUS_LABELS[inv.status] || inv.status,
  }
}

const buildRevenueTrendChart = (rows) => {
  const byMonth = new Map()
  for (const row of rows) {
    const { year, month, status } = row._id
    const key = `${year}-${month}`
    if (!byMonth.has(key)) {
      byMonth.set(key, { year, month, received: 0, projected: 0 })
    }
    const bucket = byMonth.get(key)
    if (status === 'paid') bucket.received += row.amount
    else if (status !== 'cancelled') bucket.projected += row.amount
  }

  return Array.from(byMonth.values())
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((m) => ({
      label: `${MONTH_SHORT[m.month - 1]} ${String(m.year).slice(-2)}`,
      year: m.year,
      month: m.month,
      received: m.received,
      projected: m.projected,
    }))
}

const buildExpectedPaymentsBuckets = (bucketAgg) => {
  const order = ['0-30', '31-60', '61-90', '90+']
  const byId = Object.fromEntries(bucketAgg.map((b) => [b._id, b.amount || 0]))
  const total = order.reduce((sum, key) => sum + (byId[key] || 0), 0)

  return order.map((bucket) => {
    const amount = byId[bucket] || 0
    return {
      bucket,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }
  })
}

const buildStatusDistribution = (rows) => {
  const totalPayments = rows.reduce((sum, r) => sum + (r.amount || 0), 0)
  const totalCount = rows.reduce((sum, r) => sum + (r.paymentCount || 0), 0)

  return rows.map((r) => ({
    status: r._id,
    statusLabel: STATUS_LABELS[r._id] || r._id,
    clientCount: r.count,
    paymentCount: r.paymentCount,
    amount: r.amount,
    percent: totalPayments > 0 ? Math.round((r.amount / totalPayments) * 1000) / 10 : 0,
    countSharePct: totalCount > 0 ? Math.round((r.paymentCount / totalCount) * 1000) / 10 : 0,
  }))
}

const computePaymentsDashboard = async (query = {}) => {
  const base = buildDateFilter(query)
  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const customerBase = buildCustomerInvoiceMatch(base)
  const customerRecorded = {
    ...customerBase,
    status: { $nin: ['draft', 'cancelled'] },
  }

  const parsedPage = Math.max(parseInt(query.page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(query.limit, 10) || 10, 100)

  const [
    totalAgg,
    receivedAgg,
    outstandingAgg,
    overdueByDueAgg,
    overdueYtdAgg,
    scheduledAgg,
    recentInvoices,
    recentTotal,
    statusDistributionRaw,
    revenueTrendRaw,
    expectedPaymentsRaw,
    scheduleStageAgg,
  ] = await Promise.all([
    Invoice.aggregate([
      { $match: customerRecorded },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...customerRecorded, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...customerRecorded, status: { $in: ['sent', 'overdue'] } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...customerRecorded, status: { $in: ['sent', 'overdue'] } } },
      { $addFields: invoiceDueDateAddFields },
      { $match: { effectiveDue: { $lt: now } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...customerRecorded, status: { $in: ['sent', 'overdue'] } } },
      { $addFields: invoiceDueDateAddFields },
      {
        $match: {
          effectiveDue: { $gte: yearStart, $lt: now },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    PaymentSchedule.aggregate([
      { $unwind: '$stages' },
      { $match: { 'stages.status': { $ne: 'paid' } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$stages.amount' },
          stageCount: { $sum: 1 },
        },
      },
    ]),
    Invoice.find({ ...customerBase, status: { $ne: 'cancelled' } })
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .populate('leadId', 'projectName')
      .populate('customerId', 'firstName lastName')
      .lean(),
    Invoice.countDocuments({ ...customerBase, status: { $ne: 'cancelled' } }),
    Invoice.aggregate([
      { $match: customerRecorded },
      {
        $group: {
          _id: '$status',
          clientIds: { $addToSet: '$customerId' },
          paymentCount: { $sum: 1 },
          amount: { $sum: '$totalAmount' },
        },
      },
      { $project: { _id: 1, count: { $size: '$clientIds' }, paymentCount: 1, amount: 1 } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...buildCustomerInvoiceMatch(),
          createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
          status: { $ne: 'cancelled' },
        },
      },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, status: '$status' },
          amount: { $sum: '$totalAmount' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    Invoice.aggregate([
      {
        $match: buildCustomerInvoiceMatch({
          status: { $in: ['sent', 'overdue'] },
        }),
      },
      { $addFields: invoiceDueDateAddFields },
      {
        $addFields: {
          daysLeft: {
            $floor: { $divide: [{ $subtract: ['$effectiveDue', now] }, 86400000] },
          },
        },
      },
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $lte: ['$daysLeft', 30] }, then: '0-30' },
                { case: { $lte: ['$daysLeft', 60] }, then: '31-60' },
                { case: { $lte: ['$daysLeft', 90] }, then: '61-90' },
              ],
              default: '90+',
            },
          },
          amount: { $sum: '$totalAmount' },
        },
      },
    ]),
    PaymentSchedule.aggregate([
      {
        $project: {
          customerId: 1,
          totalAmount: 1,
          initialStage: { $arrayElemAt: ['$stages', 0] },
          finalStage: { $arrayElemAt: ['$stages', -1] },
        },
      },
      {
        $group: {
          _id: null,
          totalSchedules: { $sum: 1 },
          initialPaidCount: { $sum: { $cond: [{ $eq: ['$initialStage.status', 'paid'] }, 1, 0] } },
          initialClientIds: {
            $addToSet: { $cond: [{ $eq: ['$initialStage.status', 'paid'] }, '$customerId', '$$REMOVE'] },
          },
          initialAmount: {
            $sum: { $cond: [{ $eq: ['$initialStage.status', 'paid'] }, '$initialStage.amount', 0] },
          },
          finalPaidCount: { $sum: { $cond: [{ $eq: ['$finalStage.status', 'paid'] }, 1, 0] } },
          finalClientIds: {
            $addToSet: { $cond: [{ $eq: ['$finalStage.status', 'paid'] }, '$customerId', '$$REMOVE'] },
          },
          finalAmount: {
            $sum: { $cond: [{ $eq: ['$finalStage.status', 'paid'] }, '$finalStage.amount', 0] },
          },
        },
      },
    ]),
  ])

  const totalPayments = totalAgg[0]?.total || 0
  const totalReceived = receivedAgg[0]?.total || 0
  const totalOutstanding = outstandingAgg[0]?.total || 0
  const totalOverdue = overdueByDueAgg[0]?.total || 0
  const totalOverdueYTD = overdueYtdAgg[0]?.total || 0
  const totalOverdueYTDPct =
    totalPayments > 0 ? Math.round((totalOverdueYTD / totalPayments) * 1000) / 10 : 0

  const totalScheduledToReceiveFromClients = scheduledAgg[0]?.total || 0
  const scheduledStageCount = scheduledAgg[0]?.stageCount || 0
  const totalToReceiveFromClients = totalOutstanding + totalScheduledToReceiveFromClients
  const totalInvoicedToClients = totalPayments
  const balanceDueOnInvoices = Math.max(totalInvoicedToClients - totalReceived, 0)

  const sw = scheduleStageAgg[0] || {
    totalSchedules: 0,
    initialPaidCount: 0,
    initialClientIds: [],
    initialAmount: 0,
    finalPaidCount: 0,
    finalClientIds: [],
    finalAmount: 0,
  }

  const stageWise = [
    {
      _id: 'Initial Payment',
      key: 'initial',
      progressPct: sw.totalSchedules > 0 ? Math.round((sw.initialPaidCount / sw.totalSchedules) * 100) : 0,
      clientCount: sw.initialClientIds.length,
      amount: sw.initialAmount,
    },
    {
      _id: 'Final Payment',
      key: 'final',
      progressPct: sw.totalSchedules > 0 ? Math.round((sw.finalPaidCount / sw.totalSchedules) * 100) : 0,
      clientCount: sw.finalClientIds.length,
      amount: sw.finalAmount,
    },
  ]

  const statusDistribution = buildStatusDistribution(statusDistributionRaw)
  const revenueTrendChart = buildRevenueTrendChart(revenueTrendRaw)
  const expectedPayments = buildExpectedPaymentsBuckets(expectedPaymentsRaw)
  const recentPayments = recentInvoices.map(mapRecentPaymentRow)

  return {
    stats: {
      totalPayments,
      totalInvoicedToClients,
      totalReceived,
      totalOutstanding,
      totalOverdue,
      totalOverdueYTD,
      totalOverdueYTDPct,
      totalToReceiveFromClients,
      totalScheduledToReceiveFromClients,
      scheduledStageCount,
      balanceDueOnInvoices,
    },
    statusDistribution,
    revenueTrend: revenueTrendRaw,
    revenueTrendChart,
    expectedPayments,
    stageWise,
    recentPayments,
    recentPaymentsPage: parsedPage,
    recentPaymentsLimit: parsedLimit,
    recentPaymentsTotal: recentTotal,
  }
}

module.exports = {
  computePaymentsDashboard,
  mapRecentPaymentRow,
  STATUS_LABELS,
}
