const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Invoice = require('../../models/Invoice')
const Message = require('../../models/Message')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { startOfMonth, endOfMonth } = require('date-fns')

exports.getLeadStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [total, quoteReady, quoteValueAgg, paidInvoicesAgg, unread] = await Promise.all([
    Lead.countDocuments(dateFilter),
    Lead.countDocuments({ ...dateFilter, isQuoteReady: true }),
    Lead.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: '$quoteValue' } } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          status: 'paid',
          paidAt: {
            $gte: startOfMonth(new Date()),
            $lte: endOfMonth(new Date()),
          },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Message.countDocuments({ isRead: false, senderType: 'customer' }),
  ])

  return success(res, {
    totalLeads: total,
    confirmedLeads: quoteReady,
    pipelineValue: quoteValueAgg[0]?.total || 0,
    monthlyRevenue: paidInvoicesAgg[0]?.total || 0,
    unreadMessages: unread,
  })
})

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const [total, active, newThisMonth, returningAgg] = await Promise.all([
    Customer.countDocuments(dateFilter),
    Customer.countDocuments({ ...dateFilter, isActive: true }),
    Customer.countDocuments({ createdAt: { $gte: monthStart, $lte: monthEnd } }),
    // Returning = customers with more than 1 lead total
    Lead.aggregate([
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'total' },
    ]),
  ])

  return success(res, {
    total,
    active,
    newThisMonth,
    returning: returningAgg[0]?.total || 0,
  })
})

exports.getAiVsHuman = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [withAi, withSales] = await Promise.all([
    Lead.countDocuments({ ...dateFilter, isHandedToSales: false }),
    Lead.countDocuments({ ...dateFilter, isHandedToSales: true }),
  ])

  return success(res, { withAi, withSales })
})

exports.getPerformanceTrend = asyncHandler(async (req, res) => {
  const { tab = 'customers', range = '30d' } = req.query
  const rangeMap = { '7d': 7, '30d': 30, '3m': 90 }
  const days = rangeMap[range] || 30
  const now = new Date()

  const currentStart = new Date(now)
  currentStart.setDate(currentStart.getDate() - days)
  const prevStart = new Date(currentStart)
  prevStart.setDate(prevStart.getDate() - days)

  const dateMap = {}
  for (let i = 0; i < days; i++) {
    const d = new Date(currentStart)
    d.setDate(d.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    dateMap[key] = { date: key, value: 0 }
  }

  let currentTotal = 0
  let prevTotal = 0

  if (tab === 'customers') {
    const [currentDocs, prevDocs] = await Promise.all([
      Customer.find({ createdAt: { $gte: currentStart } }).select('createdAt').lean(),
      Customer.find({ createdAt: { $gte: prevStart, $lt: currentStart } }).select('createdAt').lean(),
    ])
    for (const c of currentDocs) {
      const key = new Date(c.createdAt).toISOString().slice(0, 10)
      if (dateMap[key]) dateMap[key].value++
    }
    currentTotal = currentDocs.length
    prevTotal = prevDocs.length
  } else {
    const [currentDocs, prevDocs] = await Promise.all([
      Invoice.find({ status: 'paid', paidAt: { $gte: currentStart } }).select('totalAmount paidAt').lean(),
      Invoice.find({ status: 'paid', paidAt: { $gte: prevStart, $lt: currentStart } }).select('totalAmount').lean(),
    ])
    for (const inv of currentDocs) {
      const key = new Date(inv.paidAt).toISOString().slice(0, 10)
      if (dateMap[key]) dateMap[key].value += inv.totalAmount || 0
    }
    currentTotal = currentDocs.reduce((s, i) => s + (i.totalAmount || 0), 0)
    prevTotal = prevDocs.reduce((s, i) => s + (i.totalAmount || 0), 0)
  }

  const percentageChange = prevTotal === 0
    ? (currentTotal > 0 ? 100 : 0)
    : Math.round(((currentTotal - prevTotal) / prevTotal) * 100)

  return success(res, { data: Object.values(dateMap), percentageChange, rangeLabel: range })
})
