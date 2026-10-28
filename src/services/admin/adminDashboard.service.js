/**
 * Admin Panel Dashboard aggregations — shaped to the Figma Admin Dashboard screens.
 * Supports period=today|week|month|all (or startDate/endDate).
 */
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Invoice = require('../../models/Invoice')
const Expense = require('../../models/Expense')
const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const BundlePlan = require('../../models/BundlePlan')
const Bundle = require('../../models/Bundle')
const MaterialRequest = require('../../models/MaterialRequest')
const PaymentApproval = require('../../models/PaymentApproval')
const Tax = require('../../models/Tax')
const Task = require('../../models/Task')
const FollowUp = require('../../models/FollowUp')
const FollowUpDispatchLog = require('../../models/FollowUpDispatchLog')
const AuditLog = require('../../models/AuditLog')
const DailyProductionLog = require('../../models/DailyProductionLog')
const User = require('../../models/User')
const Message = require('../../models/Message')
const {
  CLOSED_STAGES,
  SALES_LIFECYCLE_STAGES,
  BUSINESS_UNIT_LABELS,
} = require('../../config/constants')
const { buildPeriodDateFilter, buildDateFilter } = require('../../utils/dateRange')
const { computeDeliveryFinance } = require('../accountDashboard.service')
const { distinctFinancialLeadIds } = require('../../utils/financialProjectScope')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const pct = (part, whole) =>
  whole > 0 ? Math.round(((Number(part) || 0) / whole) * 1000) / 10 : 0
const momPct = (curr, prev) =>
  prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10

const SOURCE_CHANNEL_MAP = {
  chat: 'Website',
  customer_portal: 'Website',
  manual: 'Direct',
  import: 'Referrals',
}

const FUNNEL_STAGES = [
  { key: 'newLeads', label: 'New Leads', statuses: ['initial_contact'] },
  { key: 'contacted', label: 'Contacted', statuses: ['requirements_gathered'] },
  { key: 'proposalSent', label: 'Proposal Sent', statuses: ['proposal_sent'] },
  { key: 'negotiation', label: 'Negotiation', statuses: ['negotiation'] },
  { key: 'closedWon', label: 'Closed Won', statuses: CLOSED_STAGES },
]

const KANBAN_COLUMNS = [
  {
    key: 'qualified',
    label: 'Qualified',
    statuses: ['requirements_gathered'],
  },
  {
    key: 'proposal',
    label: 'Proposal',
    statuses: ['proposal_sent'],
  },
  {
    key: 'negotiation',
    label: 'Negotiation',
    statuses: ['negotiation'],
  },
]

const DEAL_BUCKETS = [
  { key: '0_50k', label: '$0 - $50K', min: 0, max: 50000 },
  { key: '50_100k', label: '$50K - $100K', min: 50000, max: 100000 },
  { key: '100_200k', label: '$100K - $200K', min: 100000, max: 200000 },
  { key: '200k_plus', label: '$200K+', min: 200000, max: Infinity },
]

const resolvePeriodQuery = (query = {}) => {
  const q = { ...query }
  if (!q.period && !q.startDate && !q.endDate) q.period = 'month'
  if (q.period === 'all') {
    const { period, ...rest } = q
    return rest
  }
  return q
}

const createdFilter = (query) => buildPeriodDateFilter(resolvePeriodQuery(query), 'createdAt')

const dayBounds = (d = new Date()) => {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  return { start, end }
}

const prevPeriodBounds = (query = {}) => {
  const q = resolvePeriodQuery(query)
  const now = new Date()
  if (q.startDate || q.endDate) {
    const start = q.startDate ? new Date(q.startDate) : new Date(0)
    const end = q.endDate ? new Date(q.endDate) : now
    const ms = Math.max(1, end - start)
    return {
      startDate: new Date(start.getTime() - ms).toISOString(),
      endDate: new Date(start.getTime() - 1).toISOString(),
    }
  }
  if (q.period === 'today') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const { start, end } = dayBounds(y)
    return { startDate: start.toISOString(), endDate: end.toISOString() }
  }
  if (q.period === 'week') {
    const end = new Date(now)
    end.setDate(end.getDate() - 7)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    return { startDate: start.toISOString(), endDate: end.toISOString() }
  }
  // month / default
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  return { startDate: start.toISOString(), endDate: end.toISOString() }
}

const leadName = (l) => {
  if (!l) return 'Lead'
  if (l.projectName) return l.projectName
  if (l.customerId?.company) return l.customerId.company
  const person = [l.customerId?.firstName, l.customerId?.lastName].filter(Boolean).join(' ')
  if (person) return person
  return l.jobId || 'Lead'
}

// ─── Section builders ───────────────────────────────────────────────────────

exports.getKpis = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const financialLeadIds = await distinctFinancialLeadIds()
  const paidFilter = {
    leadId: { $in: financialLeadIds },
    status: 'paid',
    ...buildPeriodDateFilter(resolvePeriodQuery(query), 'paidAt'),
  }

  const [totalLeads, confirmedLeads, pipelineAgg, revenueAgg, unreadMessages] =
    await Promise.all([
      Lead.countDocuments(dateFilter),
      Lead.countDocuments({ ...dateFilter, isQuoteReady: true }),
      Lead.aggregate([
        { $match: dateFilter },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$quoteValue', 0] } } } },
      ]),
      Invoice.aggregate([
        { $match: paidFilter },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$totalAmount', 0] } } } },
      ]),
      Message.countDocuments({ isRead: false, senderType: 'customer' }),
    ])

  return {
    totalLeads,
    confirmedLeads,
    pipelineValue: round2(pipelineAgg[0]?.total || 0),
    monthlyRevenue: round2(revenueAgg[0]?.total || 0),
    revenue: round2(revenueAgg[0]?.total || 0),
    unreadMessages,
  }
}

exports.getDeliveryFinance = async (query = {}) =>
  computeDeliveryFinance(resolvePeriodQuery(query))

exports.getLoadOptimization = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const prevQ = prevPeriodBounds(query)
  const prevFilter = buildDateFilter(prevQ, 'createdAt')

  const [currBundles, prevBundles, currPlans, prevPlans, currDeliveries, prevDeliveries, prodLogs] =
    await Promise.all([
      Bundle.countDocuments(dateFilter),
      Bundle.countDocuments(prevFilter),
      BundlePlan.countDocuments({ ...dateFilter, status: { $ne: 'cancelled' } }),
      BundlePlan.countDocuments({ ...prevFilter, status: { $ne: 'cancelled' } }),
      Delivery.countDocuments({
        ...dateFilter,
        status: { $nin: ['draft', 'cancelled'] },
      }),
      Delivery.countDocuments({
        ...prevFilter,
        status: { $nin: ['draft', 'cancelled'] },
      }),
      DailyProductionLog.find(
        buildPeriodDateFilter(resolvePeriodQuery(query), 'date'),
      )
        .select('utilizationPct producedTonnage plannedTonnage')
        .lean(),
    ])

  const utilVals = prodLogs.map((p) => Number(p.utilizationPct) || 0).filter((n) => n > 0)
  const avgUtilizationPct =
    utilVals.length > 0
      ? round2(utilVals.reduce((s, n) => s + n, 0) / utilVals.length)
      : 0

  // Proxy savings: lower truck count vs naive 1-bundle-per-truck assumption
  const naiveTrucks = currBundles
  const optimizationSavings = Math.max(0, (naiveTrucks - currDeliveries) * 1000)

  return {
    totalBundlesCreated: currBundles,
    totalBundlesCreatedChangePct: momPct(currBundles, prevBundles),
    totalTruckloadsPlanned: currDeliveries,
    totalTruckloadsPlannedChangePct: momPct(currDeliveries, prevDeliveries),
    avgLoadUtilizationPct: avgUtilizationPct,
    avgLoadUtilizationChangePct: 0,
    optimizationSavings: round2(optimizationSavings),
    optimizationSavingsChangePct: momPct(optimizationSavings, Math.max(0, (prevBundles - prevDeliveries) * 1000)),
    bundlePlans: currPlans,
  }
}

exports.getDeliveryOperations = async (query = {}) => {
  const { start, end } = dayBounds()
  const todayFilter = { createdAt: { $gte: start, $lte: end } }
  const deliveryDateToday = {
    deliveryDate: { $gte: start, $lte: end },
  }

  const [
    totalDeliveriesToday,
    upcomingDeliveries,
    delayedDeliveries,
    rescheduledDeliveries,
    completedDeliveriesToday,
  ] = await Promise.all([
    Delivery.countDocuments({
      $or: [todayFilter, deliveryDateToday],
      status: { $nin: ['draft', 'cancelled'] },
    }),
    Delivery.countDocuments({
      status: { $in: ['scheduled', 'confirmed', 'carrier_selected', 'material_prepared', 'loaded'] },
      deliveryDate: { $gte: start },
    }),
    Delivery.countDocuments({ status: 'delayed' }),
    Delivery.countDocuments({ status: 'rescheduled' }),
    Delivery.countDocuments({
      status: { $in: ['delivered', 'received'] },
      updatedAt: { $gte: start, $lte: end },
    }),
  ])

  return {
    totalDeliveriesToday,
    upcomingDeliveries,
    delayedDeliveries,
    rescheduledDeliveries,
    completedDeliveriesToday,
  }
}

exports.getCommunicationStatus = async (query = {}) => {
  const dateFilter = buildPeriodDateFilter(resolvePeriodQuery(query), 'sentAt')
  const logs = await FollowUpDispatchLog.find(dateFilter).select('kind status metadata sentAt').lean()
  const total = logs.length || 1
  const sent = logs.filter((l) => l.status === 'sent').length
  const failed = logs.filter((l) => l.status === 'failed').length

  const confirmations = logs.filter(
    (l) => l.kind === 'meeting_reminder' || l.metadata?.type === 'confirmation',
  )
  const hr48 = logs.filter((l) => {
    const h = Number(l.metadata?.hoursAhead ?? l.metadata?.reminderHours)
    return h === 48 || String(l.metadata?.reminderWindow || '').includes('48')
  })
  const hr24 = logs.filter((l) => {
    const h = Number(l.metadata?.hoursAhead ?? l.metadata?.reminderHours)
    return h === 24 || String(l.metadata?.reminderWindow || '').includes('24')
  })

  // Delivery confirmation proxy when dispatch logs lack reminder tags
  const confirmedDeliveries = await Delivery.countDocuments({
    status: { $in: ['confirmed', 'scheduled', ...['picked_up', 'in_transit', 'delivered']] },
  })
  const scheduledLike = await Delivery.countDocuments({
    status: { $in: ['scheduled', 'confirmed', 'bidding_sent', 'carrier_selected'] },
  })

  return {
    confirmationsSentPct:
      confirmations.length > 0
        ? pct(confirmations.filter((l) => l.status === 'sent').length, confirmations.length)
        : pct(confirmedDeliveries, Math.max(scheduledLike, 1)),
    reminders48hrSentPct:
      hr48.length > 0 ? pct(hr48.filter((l) => l.status === 'sent').length, hr48.length) : pct(sent, total),
    reminders24hrSentPct:
      hr24.length > 0 ? pct(hr24.filter((l) => l.status === 'sent').length, hr24.length) : pct(sent, total),
    failedNotificationsPct: pct(failed, total),
    totals: { sent, failed, total: logs.length },
  }
}

exports.getFreightActivity = async (query = {}) => {
  const { start, end } = dayBounds()
  const [
    activeFreightRequests,
    bidsPending,
    loadsAwardedToday,
    loadsInTransit,
    delayedShipments,
  ] = await Promise.all([
    Delivery.countDocuments({ status: { $in: ['bidding_sent', 'draft'] } }),
    FreightBid.countDocuments({ status: { $in: ['sent', 'submitted', 'resubmit_requested'] } }),
    FreightBid.countDocuments({
      status: 'selected',
      updatedAt: { $gte: start, $lte: end },
    }),
    Delivery.countDocuments({
      status: { $in: ['in_transit', 'picked_up', 'dispatched_to_site', 'loaded'] },
    }),
    Delivery.countDocuments({ status: 'delayed' }),
  ])

  return {
    activeFreightRequests,
    bidsPending,
    loadsAwardedToday,
    loadsInTransit,
    delayedShipments,
  }
}

exports.getConversionFunnel = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const counts = {}
  await Promise.all(
    FUNNEL_STAGES.map(async (s) => {
      counts[s.key] = await Lead.countDocuments({
        ...dateFilter,
        lifecycleStatus: { $in: s.statuses },
      })
    }),
  )
  const newLeads = Math.max(counts.newLeads, 1)
  const stages = FUNNEL_STAGES.map((s) => ({
    key: s.key,
    label: s.label,
    count: counts[s.key] || 0,
    pct: pct(counts[s.key] || 0, counts.newLeads || newLeads),
  }))
  // Recompute pct against top-of-funnel newLeads
  const top = stages[0]?.count || 0
  return {
    stages: stages.map((s, i) => ({
      ...s,
      pct: i === 0 ? 100 : pct(s.count, top || 1),
    })),
    newLeads: counts.newLeads || 0,
    contacted: counts.contacted || 0,
    inPipeline: (counts.proposalSent || 0) + (counts.negotiation || 0),
    closedWon: counts.closedWon || 0,
  }
}

exports.getDealSizeDistribution = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const leads = await Lead.find({
    ...dateFilter,
    quoteValue: { $gt: 0 },
  })
    .select('quoteValue')
    .lean()

  const buckets = DEAL_BUCKETS.map((b) => {
    const items = leads.filter((l) => {
      const v = Number(l.quoteValue) || 0
      return v >= b.min && v < b.max
    })
    return {
      key: b.key,
      label: b.label,
      count: items.length,
      pct: 0,
      totalValue: round2(items.reduce((s, l) => s + (l.quoteValue || 0), 0)),
    }
  })
  const total = leads.length || 1
  buckets.forEach((b) => {
    b.pct = pct(b.count, total)
  })
  const avgDealSize =
    leads.length > 0
      ? round2(leads.reduce((s, l) => s + (l.quoteValue || 0), 0) / leads.length)
      : 0

  return { buckets, averageDealSize: avgDealSize, totalDeals: leads.length }
}

exports.getReportsOverview = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const invFilter = {
    invoiceType: { $nin: ['vendor', 'freight_carrier'] },
    status: 'paid',
    ...buildPeriodDateFilter(resolvePeriodQuery(query), 'paidAt'),
  }
  const expFilter = {
    isActive: true,
    ...buildPeriodDateFilter(resolvePeriodQuery(query), 'date'),
  }

  const [customers, paidInvs, expenses] = await Promise.all([
    Customer.countDocuments(dateFilter),
    Invoice.find(invFilter).select('totalAmount paidAt').lean(),
    Expense.find(expFilter).select('amount date').lean(),
  ])

  const revenue = paidInvs.reduce((s, i) => s + (i.totalAmount || 0), 0)
  const expenseTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0)
  const income = revenue

  // Weekly series (last 7 days of the selected window, or last 7 calendar days)
  const series = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const { start, end } = dayBounds(d)
    const dayRevenue = paidInvs
      .filter((inv) => inv.paidAt && inv.paidAt >= start && inv.paidAt <= end)
      .reduce((s, inv) => s + (inv.totalAmount || 0), 0)
    const dayExpense = expenses
      .filter((e) => e.date && e.date >= start && e.date <= end)
      .reduce((s, e) => s + (e.amount || 0), 0)
    series.push({
      date: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString('en-US', { weekday: 'short' }),
      revenue: round2(dayRevenue),
      income: round2(dayRevenue),
      expense: round2(dayExpense),
    })
  }

  return {
    customers,
    revenue: round2(revenue),
    income: round2(income),
    expense: round2(expenseTotal),
    weeklySeries: series,
  }
}

exports.getLeadSources = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const rows = await Lead.aggregate([
    { $match: dateFilter },
    { $group: { _id: '$source', count: { $sum: 1 } } },
  ])
  const total = rows.reduce((s, r) => s + r.count, 0) || 1
  const bySource = rows.map((r) => ({
    source: r._id || 'unknown',
    count: r.count,
    pct: pct(r.count, total),
  }))

  const channelMap = {}
  for (const r of bySource) {
    const channel = SOURCE_CHANNEL_MAP[r.source] || 'Other'
    if (!channelMap[channel]) channelMap[channel] = 0
    channelMap[channel] += r.count
  }
  // Ensure Figma channels exist
  ;['Website', 'Social Media', 'Email Campaign', 'Referrals', 'Direct'].forEach((c) => {
    if (channelMap[c] == null) channelMap[c] = 0
  })
  // Distribute "chat" already in Website; leave Social/Email at 0 unless we have data
  const byChannel = Object.entries(channelMap).map(([channel, count]) => ({
    channel,
    count,
    pct: pct(count, total),
  }))

  return { totalLeads: total === 1 && rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.count, 0), bySource, byChannel }
}

exports.getDispatchReadiness = async (query = {}) => {
  const prevQ = prevPeriodBounds(query)
  const { start, end } = dayBounds()

  const [
    loadsReadyForPickup,
    pendingMaterial,
    pickupsToday,
    missedPickups,
    prevReady,
    prevPending,
    prevPickups,
    prevMissed,
  ] = await Promise.all([
    Delivery.countDocuments({
      status: { $in: ['confirmed', 'material_prepared', 'loaded', 'scheduled'] },
    }),
    MaterialRequest.countDocuments({
      status: { $in: ['pending'] },
    }),
    Delivery.countDocuments({
      status: { $in: ['picked_up', 'loaded', 'in_transit'] },
      updatedAt: { $gte: start, $lte: end },
    }),
    Delivery.countDocuments({
      status: { $in: ['delayed', 'cancelled'] },
      deliveryDate: { $gte: start, $lte: end },
    }),
    Delivery.countDocuments({
      status: { $in: ['confirmed', 'material_prepared', 'loaded', 'scheduled'] },
      ...buildDateFilter(prevQ, 'createdAt'),
    }),
    MaterialRequest.countDocuments({
      status: { $in: ['pending'] },
      ...buildDateFilter(prevQ, 'createdAt'),
    }),
    Delivery.countDocuments({
      status: { $in: ['picked_up', 'loaded', 'in_transit'] },
      ...buildDateFilter(prevQ, 'updatedAt'),
    }),
    Delivery.countDocuments({
      status: { $in: ['delayed', 'cancelled'] },
      ...buildDateFilter(prevQ, 'deliveryDate'),
    }),
  ])

  return {
    loadsReadyForPickup,
    loadsReadyForPickupChangePct: momPct(loadsReadyForPickup, prevReady),
    pendingMaterial,
    pendingMaterialChangePct: momPct(pendingMaterial, prevPending),
    pickupsToday,
    pickupsTodayChangePct: momPct(pickupsToday, prevPickups),
    missedPickups,
    missedPickupsChangePct: momPct(missedPickups, prevMissed),
  }
}

exports.getLeadConversion = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const stages = [
    { key: 'newLeads', label: 'New Leads', statuses: ['initial_contact'] },
    { key: 'contacted', label: 'Contacted', statuses: ['requirements_gathered'] },
    { key: 'proposalSent', label: 'Proposal sent', statuses: ['proposal_sent'] },
    { key: 'negotiation', label: 'Negotiation', statuses: ['negotiation'] },
    { key: 'closedWon', label: 'Closed win', statuses: CLOSED_STAGES },
    { key: 'closedLost', label: 'Closed lost', statuses: [] },
  ]

  const total = Math.max(await Lead.countDocuments(dateFilter), 1)
  const items = []
  for (const s of stages) {
    const count =
      s.statuses.length === 0
        ? 0
        : await Lead.countDocuments({ ...dateFilter, lifecycleStatus: { $in: s.statuses } })
    items.push({
      key: s.key,
      label: s.label,
      count,
      pct: pct(count, total),
    })
  }
  return { stages: items, totalLeads: total === 1 ? await Lead.countDocuments(dateFilter) : total }
}

exports.getTonnageSold = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const rows = await Lead.aggregate([
    {
      $match: {
        ...dateFilter,
        lifecycleStatus: { $in: CLOSED_STAGES },
      },
    },
    {
      $group: {
        _id: { $ifNull: [{ $toLower: '$buildingType' }, 'other'] },
        count: { $sum: 1 },
        value: { $sum: { $ifNull: ['$quoteValue', 0] } },
        tonnage: {
          $sum: {
            $ifNull: ['$estimatedWeightLbs', { $ifNull: ['$totalWeightLbs', 0] }],
          },
        },
      },
    },
    { $sort: { value: -1 } },
  ])

  const labelize = (raw) => {
    const t = String(raw || 'other').trim()
    if (!t || t === 'other') return 'Others'
    return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  const totalTonnage = rows.reduce((s, r) => s + (r.tonnage || r.count || 0), 0)
  const categories = rows.map((r) => {
    const weight = r.tonnage > 0 ? r.tonnage : r.count
    return {
      category: labelize(r._id),
      tonnage: round2(weight),
      deals: r.count,
      value: round2(r.value),
      pct: pct(weight, totalTonnage || 1),
    }
  })

  // Pad common Figma categories if empty
  const wanted = ['Garage', 'Workshop', 'Roof Sheets', 'Warehouse', 'Car Ports', 'Others']
  for (const w of wanted) {
    if (!categories.find((c) => c.category.toLowerCase() === w.toLowerCase())) {
      categories.push({ category: w, tonnage: 0, deals: 0, value: 0, pct: 0 })
    }
  }

  return {
    total: round2(totalTonnage || categories.reduce((s, c) => s + c.deals, 0)),
    categories,
  }
}

exports.getOpsKpis = async () => {
  const delivered = await Delivery.countDocuments({
    status: { $in: ['delivered', 'received'] },
  })
  const delayed = await Delivery.countDocuments({ status: 'delayed' })
  const rescheduled = await Delivery.countDocuments({ status: 'rescheduled' })
  const totalDone = delivered + delayed + rescheduled
  const pendingAck = await Delivery.countDocuments({
    status: { $in: ['scheduled', 'carrier_selected', 'bidding_sent'] },
  })
  const awaitingConfirm = await Delivery.countDocuments({
    status: { $in: ['scheduled', 'confirmed', 'carrier_selected'] },
  })

  return {
    onTimeDeliveryPct: pct(delivered, Math.max(totalDone, 1)),
    acknowledgementsPendingPct: pct(pendingAck, Math.max(pendingAck + awaitingConfirm, 1)),
    deliverySuccessRate: pct(delivered, Math.max(delivered + delayed, 1)),
    rescheduleRate: pct(rescheduled, Math.max(totalDone, 1)),
  }
}

exports.getPipelineStageOverview = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const stages = SALES_LIFECYCLE_STAGES.map((status) => ({
    status,
    label: status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
  }))
  const items = await Promise.all(
    stages.map(async (s) => ({
      ...s,
      count: await Lead.countDocuments({ ...dateFilter, lifecycleStatus: s.status }),
    })),
  )
  return { stages: items }
}

exports.getQueryHandling = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const [withAi, withSales] = await Promise.all([
    Lead.countDocuments({ ...dateFilter, isHandedToSales: false }),
    Lead.countDocuments({ ...dateFilter, isHandedToSales: true }),
  ])
  const total = withAi + withSales || 1
  return {
    employeeHandled: withSales,
    employeeHandledPct: pct(withSales, total),
    aiHandled: withAi,
    aiHandledPct: pct(withAi, total),
    withAi,
    withSales,
    total: withAi + withSales,
  }
}

exports.getPipelineKanban = async (query = {}, limit = 5) => {
  const dateFilter = createdFilter(query)
  const cap = Math.min(Number(limit) || 5, 20)
  const columns = []
  for (const col of KANBAN_COLUMNS) {
    const filter = { ...dateFilter, lifecycleStatus: { $in: col.statuses } }
    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter)
        .sort({ updatedAt: -1 })
        .limit(cap)
        .select('projectName quoteValue updatedAt lifecycleStatus assignedSales customerId jobId')
        .populate('assignedSales', 'name')
        .populate('customerId', 'company firstName lastName')
        .lean(),
    ])
    columns.push({
      key: col.key,
      label: col.label,
      total,
      leads: leads.map((l) => ({
        id: l._id,
        name: leadName(l),
        value: round2(l.quoteValue || 0),
        updatedAt: l.updatedAt,
        assignedTo: l.assignedSales?.name || null,
        lifecycleStatus: l.lifecycleStatus,
      })),
    })
  }
  return { columns }
}

exports.getRecentClosedDeals = async (query = {}, limit = 10) => {
  const cap = Math.min(Number(limit) || 10, 50)
  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
  weekStart.setHours(0, 0, 0, 0)

  const deals = await Lead.find({ lifecycleStatus: { $in: CLOSED_STAGES } })
    .sort({ updatedAt: -1 })
    .limit(cap)
    .select('projectName quoteValue updatedAt assignedSales lifecycleStatus customerId jobId')
    .populate('assignedSales', 'name')
    .populate('customerId', 'company firstName lastName')
    .lean()

  const weekDeals = await Lead.find({
    lifecycleStatus: { $in: CLOSED_STAGES },
    updatedAt: { $gte: weekStart },
  })
    .select('quoteValue')
    .lean()

  return {
    items: deals.map((d) => ({
      id: d._id,
      name: leadName(d),
      value: round2(d.quoteValue || 0),
      closedAt: d.updatedAt,
      assignedTo: d.assignedSales?.name || null,
      status: d.lifecycleStatus,
    })),
    totalThisWeek: round2(weekDeals.reduce((s, d) => s + (d.quoteValue || 0), 0)),
  }
}

exports.getSalesActivity = async (query = {}, limit = 15) => {
  const cap = Math.min(Number(limit) || 15, 50)
  const dateFilter = buildPeriodDateFilter(resolvePeriodQuery(query), 'createdAt')

  const [audits, follows, closed] = await Promise.all([
    AuditLog.find(dateFilter)
      .sort({ createdAt: -1 })
      .limit(cap)
      .populate('performedBy', 'name')
      .lean()
      .catch(() => []),
    FollowUp.find(dateFilter)
      .sort({ updatedAt: -1 })
      .limit(cap)
      .populate('assignedTo', 'name')
      .populate('leadId', 'projectName customerId jobId')
      .lean()
      .catch(() => []),
    Lead.find({
      lifecycleStatus: { $in: CLOSED_STAGES },
      ...buildPeriodDateFilter(resolvePeriodQuery(query), 'updatedAt'),
    })
      .sort({ updatedAt: -1 })
      .limit(cap)
      .populate('assignedSales', 'name')
      .populate('customerId', 'company firstName lastName')
      .lean(),
  ])

  const items = [
    ...closed.map((l) => ({
      type: 'deal_closed',
      title: `Deal closed: ${leadName(l)}`,
      value: round2(l.quoteValue || 0),
      at: l.updatedAt,
      actor: l.assignedSales?.name || null,
    })),
    ...follows.map((f) => ({
      type: 'follow_up',
      title: `Follow-up ${f.status || 'updated'}: ${f.leadId ? leadName(f.leadId) : 'Lead'}`,
      value: null,
      at: f.updatedAt || f.createdAt,
      actor: f.assignedTo?.name || null,
    })),
    ...(audits || []).map((a) => ({
      type: a.action || 'audit',
      title: a.action || a.type || 'Activity',
      value: null,
      at: a.createdAt,
      actor: a.performedBy?.name || null,
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, cap)

  return { items }
}

exports.getTopPerformers = async (query = {}, limit = 10) => {
  const cap = Math.min(Number(limit) || 10, 50)
  const dateFilter = createdFilter(query)
  const salesUsers = await User.find({ role: 'sales', isActive: { $ne: false } })
    .select('name email')
    .lean()

  const performance = await Promise.all(
    salesUsers.map(async (u) => {
      const [leads, closed] = await Promise.all([
        Lead.countDocuments({ ...dateFilter, assignedSales: u._id }),
        Lead.find({
          ...dateFilter,
          assignedSales: u._id,
          lifecycleStatus: { $in: CLOSED_STAGES },
        })
          .select('quoteValue')
          .lean(),
      ])
      const revenue = closed.reduce((s, l) => s + (l.quoteValue || 0), 0)
      const closedLeads = closed.length
      return {
        id: u._id,
        name: u.name,
        email: u.email,
        leads,
        closedLeads,
        revenue: round2(revenue),
        closeRate: pct(closedLeads, Math.max(leads, 1)),
      }
    }),
  )

  performance.sort((a, b) => b.revenue - a.revenue)
  const top = performance.slice(0, cap).map((p, i) => ({ ...p, rank: i + 1 }))
  const teamTotal = round2(performance.reduce((s, p) => s + p.revenue, 0))

  return {
    performers: top,
    teamTotal,
    topPerformer: top[0] || null,
  }
}

exports.getTaxSummary = async (query = {}) => {
  const dateFilter = buildPeriodDateFilter(resolvePeriodQuery(query), 'dueDate')
  const rows = await Tax.find(dateFilter).lean()
  const totalTaxDue = rows.reduce((s, t) => s + (t.payable ?? t.taxDue ?? t.amount ?? 0), 0)
  const totalSales = rows.reduce((s, t) => s + (t.taxableSales || 0), 0)
  const rates = rows.map((t) => Number(t.salesTaxRate)).filter((n) => Number.isFinite(n) && n > 0)
  const avgTaxRate =
    rates.length > 0 ? round2(rates.reduce((s, n) => s + n, 0) / rates.length) : 0

  return {
    totalTaxDue: round2(totalTaxDue),
    totalSales: round2(totalSales),
    avgTaxRate,
    filings: rows.length,
  }
}

exports.getTaxByState = async (query = {}) => {
  const dateFilter = buildPeriodDateFilter(resolvePeriodQuery(query), 'dueDate')
  const rows = await Tax.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$state',
        contracts: { $sum: 1 },
        taxDue: { $sum: { $ifNull: ['$payable', { $ifNull: ['$taxDue', '$amount'] }] } },
        totalSales: { $sum: { $ifNull: ['$taxableSales', 0] } },
        avgRate: { $avg: '$salesTaxRate' },
      },
    },
    { $sort: { taxDue: -1 } },
  ])

  return {
    states: rows.map((r) => ({
      state: r._id,
      contracts: r.contracts,
      taxDue: round2(r.taxDue),
      totalSales: round2(r.totalSales),
      taxRate: round2(r.avgRate || 0),
    })),
  }
}

exports.getTaxByBuildingType = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const rows = await Lead.aggregate([
    {
      $match: {
        ...dateFilter,
        lifecycleStatus: { $in: CLOSED_STAGES },
      },
    },
    {
      $group: {
        _id: {
          $cond: [
            { $or: [{ $eq: ['$buildingType', ''] }, { $eq: ['$buildingType', null] }] },
            'PEMB',
            '$buildingType',
          ],
        },
        sales: { $sum: { $ifNull: ['$quoteValue', 0] } },
        count: { $sum: 1 },
      },
    },
    { $sort: { sales: -1 } },
  ])

  const totalSales = rows.reduce((s, r) => s + r.sales, 0) || 1
  // Approximate tax at 6.5% when no linked tax row — dashboard distribution widget
  const DEFAULT_RATE = 0.065
  const items = rows.map((r) => {
    const tax = r.sales * DEFAULT_RATE
    return {
      buildingType: String(r._id || 'Other'),
      sales: round2(r.sales),
      tax: round2(tax),
      deals: r.count,
      pct: pct(r.sales, totalSales),
    }
  })

  return { items, totalTax: round2(items.reduce((s, i) => s + i.tax, 0)) }
}

exports.getConstructionProgress = async (query = {}, limit = 10) => {
  const cap = Math.min(Number(limit) || 10, 50)
  const plantStages = [
    'released_to_plant',
    'drawings_received',
    'bom_received',
    'fabrication_started',
    'quality_inspection',
    'packing_bundling',
    'ready_for_delivery',
    'dispatched',
  ]
  const leads = await Lead.find({
    lifecycleStatus: { $in: plantStages },
    ...createdFilter(query),
  })
    .sort({ updatedAt: -1 })
    .limit(cap)
    .select('projectName jobId lifecycleStatus assignedSales customerId')
    .populate('assignedSales', 'name')
    .populate('customerId', 'company firstName lastName')
    .lean()

  const items = await Promise.all(
    leads.map(async (l) => {
      const [totalTasks, doneTasks] = await Promise.all([
        Task.countDocuments({ leadId: l._id }),
        Task.countDocuments({ leadId: l._id, status: { $in: ['done', 'completed'] } }),
      ])
      const progressPct = totalTasks > 0 ? pct(doneTasks, totalTasks) : 0
      let statusLabel = 'On Track'
      if (progressPct < 30) statusLabel = 'Starting'
      else if (progressPct < 60) statusLabel = 'On Track'
      else if (l.lifecycleStatus === 'delayed') statusLabel = 'Delayed'

      return {
        id: l._id,
        projectName: l.projectName || leadName(l),
        projectCode: l.jobId || null,
        manager: l.assignedSales?.name || null,
        lifecycleStatus: l.lifecycleStatus,
        statusLabel,
        progressPct,
      }
    }),
  )

  return { projects: items }
}

exports.getPlantProduction = async (query = {}) => {
  const prevQ = prevPeriodBounds(query)
  const expFilter = {
    isActive: true,
    category: { $in: ['materials', 'material', 'Materials'] },
    ...buildPeriodDateFilter(resolvePeriodQuery(query), 'date'),
  }
  const prevExpFilter = {
    isActive: true,
    category: { $in: ['materials', 'material', 'Materials'] },
    ...buildDateFilter(prevQ, 'date'),
  }

  const [materialValueAgg, outflowAgg, prevOutflowAgg, reorderPending, prevReorder, alerts] =
    await Promise.all([
      Invoice.aggregate([
        {
          $match: {
            invoiceType: { $nin: ['vendor', 'freight_carrier'] },
            status: { $in: ['paid', 'sent', 'draft'] },
            ...buildPeriodDateFilter(resolvePeriodQuery(query), 'createdAt'),
          },
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Expense.aggregate([
        { $match: expFilter },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Expense.aggregate([
        { $match: prevExpFilter },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      MaterialRequest.countDocuments({
        status: { $in: ['pending'] },
      }),
      MaterialRequest.countDocuments({
        status: { $in: ['pending'] },
        ...buildDateFilter(prevQ, 'createdAt'),
      }),
      MaterialRequest.countDocuments({
        priority: { $in: ['urgent', 'high'] },
        status: { $nin: ['fulfilled', 'cancelled'] },
      }),
    ])

  const materialValue = materialValueAgg[0]?.total || 0
  const outflow = outflowAgg[0]?.total || 0
  const prevOutflow = prevOutflowAgg[0]?.total || 0

  return {
    materialValue: round2(materialValue),
    materialValueChangePct: 0,
    outflowThisMonth: round2(outflow),
    outflowChangePct: momPct(outflow, prevOutflow),
    reorderRequestsPending: reorderPending,
    reorderRequestsChangePct: momPct(reorderPending, prevReorder),
    emergencyMaterialAlerts: alerts,
    emergencyAlertsChangePct: 0,
  }
}

exports.getBusinessHighlights = async (query = {}) => {
  const dateFilter = createdFilter(query)
  const byUnit = await Lead.aggregate([
    { $match: { ...dateFilter, quoteValue: { $gt: 0 } } },
    {
      $group: {
        _id: '$businessUnit',
        value: { $sum: '$quoteValue' },
        count: { $sum: 1 },
      },
    },
    { $sort: { value: -1 } },
  ])
  const topUnit = byUnit[0]
  const topSector = topUnit
    ? {
        key: topUnit._id || 'unknown',
        label: BUSINESS_UNIT_LABELS[topUnit._id] || topUnit._id || 'Unknown',
        value: round2(topUnit.value),
        deals: topUnit.count,
        monthOverMonthPct: 0,
      }
    : null

  const byCustomer = await Lead.aggregate([
    {
      $match: {
        ...dateFilter,
        lifecycleStatus: { $in: CLOSED_STAGES },
        customerId: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$customerId',
        revenue: { $sum: '$quoteValue' },
        count: { $sum: 1 },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 1 },
  ])

  let topCustomer = null
  if (byCustomer[0]) {
    const c = await Customer.findById(byCustomer[0]._id).select('company firstName lastName').lean()
    const name =
      c?.company || [c?.firstName, c?.lastName].filter(Boolean).join(' ') || 'Customer'
    // Profit proxy: revenue − related expenses
    const expenses = await Expense.aggregate([
      {
        $match: {
          isActive: true,
          customerId: byCustomer[0]._id,
          ...buildPeriodDateFilter(resolvePeriodQuery(query), 'date'),
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    const profit = byCustomer[0].revenue - (expenses[0]?.total || 0)
    topCustomer = {
      id: byCustomer[0]._id,
      name,
      totalProfit: round2(profit),
      revenue: round2(byCustomer[0].revenue),
      deals: byCustomer[0].count,
    }
  }

  const paid = await Invoice.aggregate([
    {
      $match: {
        invoiceType: { $nin: ['vendor', 'freight_carrier'] },
        status: 'paid',
        ...buildPeriodDateFilter(resolvePeriodQuery(query), 'paidAt'),
      },
    },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ])
  const exp = await Expense.aggregate([
    {
      $match: {
        isActive: true,
        ...buildPeriodDateFilter(resolvePeriodQuery(query), 'date'),
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  const oi = (paid[0]?.total || 0) - (exp[0]?.total || 0)

  return {
    topSector,
    topCustomerByProfit: topCustomer,
    currentMonthOI: round2(oi),
    oiGrowthRatePct: 0,
  }
}

exports.getCustomerApprovals = async (query = {}, limit = 10) => {
  const cap = Math.min(Number(limit) || 10, 50)
  const [approvals, invoiceCount, recentInvoices] = await Promise.all([
    PaymentApproval.find({})
      .sort({ createdAt: -1 })
      .limit(cap)
      .populate('leadId', 'companyName projectName')
      .lean(),
    Invoice.countDocuments({
      invoiceType: { $nin: ['vendor', 'freight_carrier'] },
      ...createdFilter(query),
    }),
    Invoice.find({
      invoiceType: { $nin: ['vendor', 'freight_carrier'] },
      ...createdFilter(query),
    })
      .sort({ createdAt: -1 })
      .limit(cap)
      .populate('leadId', 'companyName projectName')
      .select('invoiceNumber totalAmount status createdAt leadId')
      .lean(),
  ])

  return {
    activities: (approvals || []).map((a) => ({
      id: a._id,
      name: a.leadId ? leadName(a.leadId) : a.payeeName || 'Payee',
      date: a.createdAt,
      status: a.status,
      amount: round2(a.amount || 0),
      type: a.payeeType || 'approval',
    })),
    totalInvoicesGenerated: invoiceCount,
    invoices: recentInvoices.map((i) => ({
      id: i._id,
      invoiceNumber: i.invoiceNumber,
      name: i.leadId ? leadName(i.leadId) : 'Customer',
      amount: round2(i.totalAmount || 0),
      status: i.status,
      date: i.createdAt,
    })),
  }
}

exports.getSalesMix = async (query = {}) => {
  const paid = await Invoice.aggregate([
    {
      $match: {
        invoiceType: { $nin: ['vendor', 'freight_carrier'] },
        status: 'paid',
        ...buildPeriodDateFilter(resolvePeriodQuery(query), 'paidAt'),
      },
    },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ])
  const allInv = await Invoice.aggregate([
    {
      $match: {
        invoiceType: { $nin: ['vendor', 'freight_carrier'] },
        ...createdFilter(query),
      },
    },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ])
  const exp = await Expense.aggregate([
    {
      $match: {
        isActive: true,
        ...buildPeriodDateFilter(resolvePeriodQuery(query), 'date'),
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])

  const sales = allInv[0]?.total || 0
  const revenue = paid[0]?.total || 0
  const expenses = exp[0]?.total || 0
  const sum = sales + revenue + expenses || 1

  return {
    sales: round2(sales),
    revenue: round2(revenue),
    expenses: round2(expenses),
    slices: [
      { key: 'sales', label: 'Sales', amount: round2(sales), pct: pct(sales, sum) },
      { key: 'revenue', label: 'Revenue', amount: round2(revenue), pct: pct(revenue, sum) },
      { key: 'expenses', label: 'Expenses', amount: round2(expenses), pct: pct(expenses, sum) },
    ],
  }
}

exports.searchGlobal = async (q = '', limit = 20) => {
  const term = String(q || '').trim()
  if (!term) return { leads: [], projects: [], customers: [], query: term }
  const cap = Math.min(Number(limit) || 20, 50)
  const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const [leads, customers] = await Promise.all([
    Lead.find({
      $or: [{ projectName: rx }, { jobId: rx }, { location: rx }, { buildingType: rx }],
    })
      .sort({ updatedAt: -1 })
      .limit(cap)
      .select('projectName jobId quoteValue lifecycleStatus customerId')
      .populate('customerId', 'company firstName lastName email')
      .lean(),
    Customer.find({
      $or: [{ company: rx }, { firstName: rx }, { lastName: rx }, { email: rx }],
    })
      .sort({ updatedAt: -1 })
      .limit(cap)
      .select('company firstName lastName email')
      .lean(),
  ])

  return {
    query: term,
    leads: leads.map((l) => ({
      id: l._id,
      type: 'lead',
      name: leadName(l),
      projectName: l.projectName,
      projectId: l.jobId,
      value: round2(l.quoteValue || 0),
      status: l.lifecycleStatus,
    })),
    projects: leads
      .filter((l) => l.projectName || l.jobId)
      .map((l) => ({
        id: l._id,
        type: 'project',
        name: l.projectName || l.jobId,
        projectId: l.jobId,
        status: l.lifecycleStatus,
      })),
    customers: customers.map((c) => ({
      id: c._id,
      type: 'customer',
      name: c.company || [c.firstName, c.lastName].filter(Boolean).join(' '),
      email: c.email,
    })),
  }
}

exports.getOverview = async (query = {}) => {
  const [
    kpis,
    deliveryFinance,
    loadOptimization,
    deliveryOperations,
    communicationStatus,
    freightActivity,
    conversionFunnel,
    dealSizeDistribution,
    reportsOverview,
    leadSources,
    dispatchReadiness,
    leadConversion,
    tonnageSold,
    opsKpis,
    pipelineStageOverview,
    queryHandling,
    pipelineKanban,
    recentClosedDeals,
    salesActivity,
    topPerformers,
    taxSummary,
    taxByState,
    taxByBuildingType,
    constructionProgress,
    plantProduction,
    businessHighlights,
    customerApprovals,
    salesMix,
  ] = await Promise.all([
    exports.getKpis(query),
    exports.getDeliveryFinance(query),
    exports.getLoadOptimization(query),
    exports.getDeliveryOperations(query),
    exports.getCommunicationStatus(query),
    exports.getFreightActivity(query),
    exports.getConversionFunnel(query),
    exports.getDealSizeDistribution(query),
    exports.getReportsOverview(query),
    exports.getLeadSources(query),
    exports.getDispatchReadiness(query),
    exports.getLeadConversion(query),
    exports.getTonnageSold(query),
    exports.getOpsKpis(query),
    exports.getPipelineStageOverview(query),
    exports.getQueryHandling(query),
    exports.getPipelineKanban(query, 5),
    exports.getRecentClosedDeals(query, 8),
    exports.getSalesActivity(query, 12),
    exports.getTopPerformers(query, 8),
    exports.getTaxSummary(query),
    exports.getTaxByState(query),
    exports.getTaxByBuildingType(query),
    exports.getConstructionProgress(query, 8),
    exports.getPlantProduction(query),
    exports.getBusinessHighlights(query),
    exports.getCustomerApprovals(query, 8),
    exports.getSalesMix(query),
  ])

  return {
    period: resolvePeriodQuery(query).period || 'custom',
    generatedAt: new Date().toISOString(),
    kpis,
    deliveryFinance,
    loadOptimization,
    deliveryOperations,
    communicationStatus,
    freightActivity,
    conversionFunnel,
    dealSizeDistribution,
    reportsOverview,
    leadSources,
    dispatchReadiness,
    leadConversion,
    tonnageSold,
    opsKpis,
    pipelineStageOverview,
    queryHandling,
    pipelineKanban,
    recentClosedDeals,
    salesActivity,
    topPerformers,
    taxSummary,
    taxByState,
    taxByBuildingType,
    constructionProgress,
    plantProduction,
    businessHighlights,
    customerApprovals,
    salesMix,
  }
}
