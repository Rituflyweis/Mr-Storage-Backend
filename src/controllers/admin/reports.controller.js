const Lead = require('../../models/Lead')
const Invoice = require('../../models/Invoice')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { CLOSED_STAGES, LIFECYCLE_STAGES } = require('../../config/constants')
const { endOfMonth, format, startOfMonth, subMonths } = require('date-fns')

const roundRate = (conversions, leads) => {
  if (!leads) return 0
  return Math.round((conversions / leads) * 1000) / 10
}

const buildLeadStatusFilter = (lifecycleStatus) => {
  if (!lifecycleStatus || lifecycleStatus === 'all') return {}
  if (!LIFECYCLE_STAGES.includes(lifecycleStatus)) return { error: 'Invalid lifecycleStatus' }
  return { lifecycleStatus }
}

/** Months to include in detailed table (oldest → newest). */
const buildMonthWindows = (monthsCount) => {
  const now = new Date()
  const windows = []
  for (let i = monthsCount - 1; i >= 0; i--) {
    const anchor = subMonths(now, i)
    windows.push({
      monthKey: format(anchor, 'yyyy-MM'),
      month: format(anchor, 'MMM'),
      start: startOfMonth(anchor),
      end: endOfMonth(anchor),
    })
  }
  return windows
}

const countNewLeads = (leadFilter, start, end) =>
  Lead.countDocuments({ ...leadFilter, createdAt: { $gte: start, $lte: end } })

const countConversions = (leadFilter, start, end) =>
  Lead.countDocuments({
    ...leadFilter,
    lifecycleStatus: { $in: CLOSED_STAGES },
    updatedAt: { $gte: start, $lte: end },
  })

const sumRevenue = async (leadFilter, start, end) => {
  const leadIds = await Lead.find(leadFilter).distinct('_id')
  if (!leadIds.length) return 0

  const agg = await Invoice.aggregate([
    {
      $match: {
        leadId: { $in: leadIds },
        status: 'paid',
        paidAt: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ])
  return agg[0]?.total || 0
}

exports.getSalesAnalytics = asyncHandler(async (req, res) => {
  const { lifecycleStatus, timeframe = 'monthly' } = req.query
  const monthsCount = Math.min(Math.max(Number(req.query.months) || 6, 1), 24)

  if (timeframe !== 'monthly') {
    return badRequest(res, 'Invalid timeframe. Use monthly')
  }

  const statusFilter = buildLeadStatusFilter(lifecycleStatus)
  if (statusFilter.error) return badRequest(res, statusFilter.error)

  const leadFilter = { ...statusFilter }
  const monthWindows = buildMonthWindows(monthsCount)

  const currentMonth = monthWindows[monthWindows.length - 1]
  const [thisMonthRevenue, thisMonthLeads, thisMonthConversions] = await Promise.all([
    sumRevenue(leadFilter, currentMonth.start, currentMonth.end),
    countNewLeads(leadFilter, currentMonth.start, currentMonth.end),
    countConversions(leadFilter, currentMonth.start, currentMonth.end),
  ])

  const monthlyBreakdown = await Promise.all(
    monthWindows.map(async ({ month, monthKey, start, end }) => {
      const [revenue, leads, conversions] = await Promise.all([
        sumRevenue(leadFilter, start, end),
        countNewLeads(leadFilter, start, end),
        countConversions(leadFilter, start, end),
      ])
      return {
        month,
        monthKey,
        revenue,
        leads,
        conversions,
        conversionRate: roundRate(conversions, leads),
      }
    })
  )

  const detailedSummary = monthlyBreakdown.reduce(
    (acc, row) => ({
      totalRevenue: acc.totalRevenue + row.revenue,
      totalLeads: acc.totalLeads + row.leads,
      conversions: acc.conversions + row.conversions,
    }),
    { totalRevenue: 0, totalLeads: 0, conversions: 0 }
  )

  return success(res, {
    quickOverview: {
      revenue: thisMonthRevenue,
      newLeads: thisMonthLeads,
      conversions: thisMonthConversions,
      conversionRate: roundRate(thisMonthConversions, thisMonthLeads),
    },
    detailedSummary: {
      ...detailedSummary,
      conversionRate: roundRate(detailedSummary.conversions, detailedSummary.totalLeads),
    },
    monthlyBreakdown,
    filters: {
      lifecycleStatus: lifecycleStatus || 'all',
      timeframe: 'monthly',
      months: monthsCount,
    },
  })
})
