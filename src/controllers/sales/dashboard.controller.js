const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Invoice = require('../../models/Invoice')
const Message = require('../../models/Message')
const FollowUp = require('../../models/FollowUp')
const Escalation = require('../../models/Escalation')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { CLOSED_STAGES } = require('../../config/constants')
const {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
} = require('date-fns')

const TREND_RANGE_DAYS = { '7d': 7, '30d': 30, '3m': 90 }

const resolveTrendWindow = (query = {}) => {
  const now = new Date()

  if (query.startDate || query.endDate) {
    const parsedStart = query.startDate ? new Date(query.startDate) : null
    const parsedEnd = query.endDate ? new Date(query.endDate) : now

    const end = !isNaN(parsedEnd) ? endOfDay(parsedEnd) : endOfDay(now)
    const startFromQuery = parsedStart && !isNaN(parsedStart) ? startOfDay(parsedStart) : startOfDay(end)
    const start = startFromQuery <= end ? startFromQuery : startOfDay(end)
    const totalDays = Math.max(differenceInCalendarDays(end, start) + 1, 1)

    return {
      start,
      end,
      totalDays,
      rangeLabel: `${format(start, 'yyyy-MM-dd')} to ${format(end, 'yyyy-MM-dd')}`,
    }
  }

  const range = TREND_RANGE_DAYS[query.range] ? query.range : '7d'
  const totalDays = TREND_RANGE_DAYS[range]
  const end = endOfDay(now)
  const start = startOfDay(subDays(end, totalDays - 1))
  const rangeLabel = range === '3m' ? 'Last 3 months' : `Last ${totalDays} days`

  return { start, end, totalDays, rangeLabel }
}

const buildDailySeries = (start, end, rows = []) => {
  const points = new Map(rows.map(r => [r._id, r.value]))
  const data = []
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) {
    const key = format(d, 'yyyy-MM-dd')
    data.push({ date: key, value: points.get(key) || 0 })
  }
  return data
}

const calcPctChange = (currentTotal, prevTotal) => {
  if (prevTotal === 0) return currentTotal > 0 ? 100 : 0
  return Number((((currentTotal - prevTotal) / prevTotal) * 100).toFixed(2))
}

// v2 dashboard API
exports.getStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)

  const [totalLeads, leadsClosed, followUpPending, escalationsPending] = await Promise.all([
    Lead.countDocuments({ assignedSales: salesId, ...dateFilter }),
    Lead.countDocuments({
      assignedSales: salesId,
      lifecycleStatus: { $in: CLOSED_STAGES },
      ...dateFilter,
    }),
    FollowUp.countDocuments({ assignedTo: salesId, status: 'pending', ...dateFilter }),
    Escalation.countDocuments({ raisedBy: salesId, status: 'pending', ...dateFilter }),
  ])

  return success(res, { totalLeads, leadsClosed, followUpPending, escalationsPending })
})

// v2 dashboard API
exports.getConversionFunnel = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)
  const base = { assignedSales: salesId, ...dateFilter }

  const [newLeads, contacted, inPipeline, closedWon] = await Promise.all([
    Lead.countDocuments({ ...base, lifecycleStatus: 'initial_contact' }),
    Lead.countDocuments({
      ...base,
      lifecycleStatus: { $in: ['requirements_gathered', 'requirements_collected'] },
    }),
    Lead.countDocuments({
      ...base,
      lifecycleStatus: { $in: ['proposal_sent', 'negotiation'] },
    }),
    Lead.countDocuments({
      ...base,
      lifecycleStatus: { $in: CLOSED_STAGES },
    }),
  ])

  return success(res, { newLeads, contacted, inPipeline, closedWon })
})

// v2 dashboard API
exports.getPerformanceTrend = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const tab = req.query.tab || 'customers'
  if (!['customers', 'revenue'].includes(tab)) {
    return badRequest(res, 'Invalid tab. Use customers or revenue')
  }

  const { start, end, totalDays, rangeLabel } = resolveTrendWindow(req.query)
  const prevEnd = endOfDay(subDays(start, 1))
  const prevStart = startOfDay(subDays(start, totalDays))

  if (tab === 'customers') {
    const customerIds = await Lead.find({ assignedSales: salesId }).distinct('customerId')
    const customerScope = customerIds.length ? { _id: { $in: customerIds } } : { _id: { $in: [] } }

    const [currentRows, currentTotal, prevTotal] = await Promise.all([
      Customer.aggregate([
        { $match: { ...customerScope, createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            value: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Customer.countDocuments({ ...customerScope, createdAt: { $gte: start, $lte: end } }),
      Customer.countDocuments({ ...customerScope, createdAt: { $gte: prevStart, $lte: prevEnd } }),
    ])

    return success(res, {
      data: buildDailySeries(start, end, currentRows),
      percentageChange: calcPctChange(currentTotal, prevTotal),
      rangeLabel,
    })
  }

  const leadIds = await Lead.find({ assignedSales: salesId }).distinct('_id')
  const leadScope = leadIds.length ? { leadId: { $in: leadIds } } : { leadId: { $in: [] } }

  const [currentRows, currentAgg, prevAgg] = await Promise.all([
    Invoice.aggregate([
      {
        $match: {
          ...leadScope,
          status: 'paid',
          paidAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          value: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...leadScope,
          status: 'paid',
          paidAt: { $gte: start, $lte: end },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...leadScope,
          status: 'paid',
          paidAt: { $gte: prevStart, $lte: prevEnd },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
  ])

  const currentTotal = currentAgg[0]?.total || 0
  const prevTotal = prevAgg[0]?.total || 0

  return success(res, {
    data: buildDailySeries(start, end, currentRows),
    percentageChange: calcPctChange(currentTotal, prevTotal),
    rangeLabel,
  })
})

// v2 dashboard API
exports.getTodayTasks = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const now = new Date()
  const start = req.query.startDate ? startOfDay(new Date(req.query.startDate)) : startOfDay(now)
  const end = req.query.endDate ? endOfDay(new Date(req.query.endDate)) : endOfDay(now)

  const followUpDateFilter = {}
  const createdDateFilter = {}
  if (!isNaN(start) && !isNaN(end) && start <= end) {
    followUpDateFilter.followUpDate = { $gte: start, $lte: end }
    createdDateFilter.createdAt = { $gte: start, $lte: end }
  } else {
    followUpDateFilter.followUpDate = { $gte: startOfDay(now), $lte: endOfDay(now) }
    createdDateFilter.createdAt = { $gte: startOfDay(now), $lte: endOfDay(now) }
  }

  const [followUpsToday, newLeadsToday, pendingEscalations] = await Promise.all([
    FollowUp.find({
      assignedTo: salesId,
      status: 'pending',
      ...followUpDateFilter,
    })
      .select('_id followUpDate notes priority leadId customerId')
      .populate({ path: 'leadId', select: 'projectName' })
      .populate({ path: 'customerId', select: 'firstName' })
      .sort({ followUpDate: 1 })
      .lean(),

    Lead.find({
      assignedSales: salesId,
      ...createdDateFilter,
    })
      .select('_id projectName buildingType lifecycleStatus customerId')
      .populate({ path: 'customerId', select: 'firstName' })
      .sort({ createdAt: -1 })
      .lean(),

    Escalation.find({
      raisedBy: salesId,
      status: 'pending',
      ...createdDateFilter,
    })
      .select('_id note status createdAt leadId')
      .populate({ path: 'leadId', select: 'projectName' })
      .sort({ createdAt: -1 })
      .lean(),
  ])

  const followUpsCount = followUpsToday.length
  const newLeadsCount = newLeadsToday.length
  const escalationsCount = pendingEscalations.length

  return success(res, {
    followUpsToday,
    newLeadsToday,
    pendingEscalations,
    summary: {
      totalTasks: followUpsCount + newLeadsCount + escalationsCount,
      followUpsCount,
      newLeadsCount,
      escalationsCount,
    },
  })
})

exports.getLeadStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)
  const base = { assignedSales: salesId, ...dateFilter }

  const [total, quoteReady, quoteValueAgg, unread] = await Promise.all([
    Lead.countDocuments(base),
    Lead.countDocuments({ ...base, isQuoteReady: true }),
    Lead.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$quoteValue' } } }]),
    Message.countDocuments({
      isRead: false,
      senderType: 'customer',
      leadId: { $in: await Lead.find(base).distinct('_id') },
    }),
  ])

  return success(res, {
    totalLeads: total,
    confirmedLeads: quoteReady,
    pipelineValue: quoteValueAgg[0]?.total || 0,
    unreadMessages: unread,
  })
})

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)

  const myLeads = await Lead.find({ assignedSales: salesId }).distinct('customerId')
  const base = { _id: { $in: myLeads }, ...dateFilter }

  const now = new Date()
  const [total, active, newThisMonth] = await Promise.all([
    Customer.countDocuments(base),
    Customer.countDocuments({ ...base, isActive: true }),
    Customer.countDocuments({ ...base, createdAt: { $gte: startOfMonth(now), $lte: endOfMonth(now) } }),
  ])

  return success(res, { total, active, newThisMonth })
})
