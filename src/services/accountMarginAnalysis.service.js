const mongoose = require('mongoose')
const Invoice = require('../models/Invoice')
const Expense = require('../models/Expense')
const Lead = require('../models/Lead')
const Tax = require('../models/Tax')
const { buildDateFilter } = require('../utils/dateRange')
const { buildBusinessUnitFilter } = require('../utils/businessUnit')
const {
  buildPeriodPL,
  resolvePeriodRange,
  pctChange,
  marginPct,
} = require('../utils/profitLossPeriod.util')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const buildProjectFilter = async (query = {}) => {
  const filter = {}
  if (query.projectId || query.leadId) {
    filter.leadId = new mongoose.Types.ObjectId(query.projectId || query.leadId)
    return filter
  }
  const bu = buildBusinessUnitFilter(query.businessUnit || query.company)
  if (bu) {
    const leadIds = await Lead.find({ ...bu, isTerminated: { $ne: true } }).distinct('_id')
    filter.leadId = { $in: leadIds }
  }
  return filter
}

const resolveEffectiveDates = (query) => {
  const now = new Date()
  const resolved = !query.startDate && !query.endDate ? resolvePeriodRange(query.period, now) : null
  const startDate = query.startDate || resolved?.start?.toISOString()
  const endDate = query.endDate || resolved?.end?.toISOString()
  return { startDate, endDate }
}

exports.getMarginFilters = async () => {
  const [projects, businessUnits] = await Promise.all([
    Lead.find({ isTerminated: { $ne: true }, isArchived: { $ne: true } })
      .select('projectName jobId businessUnit')
      .sort({ projectName: 1 })
      .limit(500)
      .lean(),
    Lead.distinct('businessUnit', { businessUnit: { $nin: [null, ''] } }),
  ])

  return {
    companies: businessUnits.filter(Boolean).map((bu) => ({ id: bu, label: bu })),
    projects: projects.map((p) => ({
      leadId: p._id,
      projectName: p.projectName,
      jobId: p.jobId,
      businessUnit: p.businessUnit || null,
    })),
    currencies: [{ code: 'USD', label: 'USD' }],
  }
}

exports.getMarginAnalysisSummary = async (query = {}) => {
  const projectFilter = await buildProjectFilter(query)
  const { startDate, endDate } = resolveEffectiveDates(query)
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const periodEnd = endDate ? new Date(endDate) : new Date()
  const periodStart = startDate ? new Date(startDate) : new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)
  const lengthMs = periodEnd.getTime() - periodStart.getTime()
  const prevEnd = new Date(periodStart.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - lengthMs)
  const prevDateFilter = buildDateFilter(
    { startDate: prevStart.toISOString(), endDate: prevEnd.toISOString() },
    'date'
  )

  const [current, previous] = await Promise.all([
    buildPeriodPL(projectFilter, dateFilter),
    buildPeriodPL(projectFilter, prevDateFilter),
  ])

  const revenue = current.totalIncome
  const grossMarginPct = marginPct(current.grossProfit, revenue)
  const operatingMarginPct = marginPct(current.operatingProfit, revenue)
  const netProfitMarginPct = marginPct(current.netProfit, revenue)
  const contributionMarginPct = marginPct(revenue - current.cogs, revenue)

  const prevGross = marginPct(previous.grossProfit, previous.totalIncome)
  const prevOperating = marginPct(previous.operatingProfit, previous.totalIncome)
  const prevNet = marginPct(previous.netProfit, previous.totalIncome)
  const prevContribution = marginPct(previous.totalIncome - previous.cogs, previous.totalIncome)

  const avgSellingPrice =
    current.paidInvoiceCount > 0 ? round2(revenue / current.paidInvoiceCount) : 0
  const prevAvg =
    previous.paidInvoiceCount > 0
      ? round2(previous.totalIncome / previous.paidInvoiceCount)
      : 0

  return {
    grossMarginPct,
    operatingMarginPct,
    netProfitMarginPct,
    contributionMarginPct,
    avgSellingPrice,
    period: { startDate, endDate },
    kpis: {
      grossMarginPct: { value: grossMarginPct, changePct: pctChange(grossMarginPct, prevGross) },
      operatingMarginPct: { value: operatingMarginPct, changePct: pctChange(operatingMarginPct, prevOperating) },
      netProfitMarginPct: { value: netProfitMarginPct, changePct: pctChange(netProfitMarginPct, prevNet) },
      contributionMarginPct: {
        value: contributionMarginPct,
        changePct: pctChange(contributionMarginPct, prevContribution),
      },
      avgSellingPrice: { value: avgSellingPrice, changePct: pctChange(avgSellingPrice, prevAvg) },
    },
    totals: {
      revenue: round2(revenue),
      cogs: round2(current.cogs),
      grossProfit: round2(current.grossProfit),
      operatingProfit: round2(current.operatingProfit),
      netProfit: round2(current.netProfit),
    },
  }
}

exports.getMarginTrendOverTime = async (query = {}) => {
  const { period = 'month' } = query
  if (!['month', 'quarter', 'year'].includes(period)) {
    return { error: 'period must be month, quarter, or year' }
  }

  const projectFilter = await buildProjectFilter(query)
  const now = new Date()
  const rangeStart =
    period === 'year'
      ? new Date(now.getFullYear() - 4, 0, 1)
      : period === 'quarter'
        ? new Date(now.getFullYear() - 2, 0, 1)
        : new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const groupId =
    period === 'year'
      ? { year: { $year: '$date' } }
      : period === 'quarter'
        ? { year: { $year: '$date' }, quarter: { $ceil: { $divide: [{ $month: '$date' }, 3] } } }
        : { year: { $year: '$date' }, month: { $month: '$date' } }

  const taxGroupId =
    period === 'year'
      ? { year: { $year: '$createdAt' } }
      : period === 'quarter'
        ? {
            year: { $year: '$createdAt' },
            quarter: { $ceil: { $divide: [{ $month: '$createdAt' }, 3] } },
          }
        : { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }

  const [revenueAgg, expenseAgg, taxAgg] = await Promise.all([
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
    Tax.aggregate([
      { $match: { status: 'paid', createdAt: { $gte: rangeStart } } },
      { $group: { _id: taxGroupId, tax: { $sum: '$amount' } } },
    ]),
  ])

  const keyOf = (id) =>
    period === 'year'
      ? `${id.year}`
      : period === 'quarter'
        ? `${id.year}-Q${id.quarter}`
        : `${id.year}-${String(id.month).padStart(2, '0')}`

  const revenueByKey = new Map(revenueAgg.map((r) => [keyOf(r._id), r.revenue]))
  const expenseByKey = new Map(expenseAgg.map((e) => [keyOf(e._id), e.expense]))
  const taxByKey = new Map(taxAgg.map((t) => [keyOf(t._id), t.tax]))
  const allKeys = [...new Set([...revenueByKey.keys(), ...expenseByKey.keys()])].sort()

  const trend = allKeys.map((key) => {
    const revenue = revenueByKey.get(key) || 0
    const expense = expenseByKey.get(key) || 0
    const tax = taxByKey.get(key) || 0
    const cogsEstimate = expense * 0.55
    const grossProfit = revenue - cogsEstimate
    const operatingProfit = revenue - expense
    const netProfit = operatingProfit - tax
    return {
      period: key,
      label: key,
      grossMarginPct: marginPct(grossProfit, revenue),
      operatingMarginPct: marginPct(operatingProfit, revenue),
      netProfitMarginPct: marginPct(netProfit, revenue),
      contributionMarginPct: marginPct(revenue - cogsEstimate, revenue),
    }
  })

  return { period, trend }
}

exports.getMarginByProjects = async (query = {}) => {
  const { startDate, endDate, limit = 10 } = query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const filter = await buildProjectFilter(query)

  const revenueByProject = await Invoice.aggregate([
    { $match: { ...filter, ...dateFilter, status: 'paid' } },
    { $group: { _id: '$leadId', revenue: { $sum: '$totalAmount' } } },
    { $sort: { revenue: -1 } },
    { $limit: parseInt(limit, 10) },
    { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'lead' } },
    { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
  ])

  const projects = await Promise.all(
    revenueByProject.map(async (r) => {
      const pl = await buildPeriodPL({ leadId: r._id }, dateFilter)
      return {
        leadId: r._id,
        projectName: r.lead?.projectName || '',
        jobId: r.lead?.jobId || '',
        category: r.lead?.businessUnit || r.lead?.lifecycleStatus || '',
        revenue: round2(r.revenue),
        cogs: round2(pl.cogs),
        grossProfit: round2(pl.grossProfit),
        grossMarginPct: marginPct(pl.grossProfit, r.revenue),
        operatingMarginPct: marginPct(pl.operatingProfit, r.revenue),
        netProfitMarginPct: marginPct(pl.netProfit, r.revenue),
        contributionMarginPct: marginPct(r.revenue - pl.cogs, r.revenue),
      }
    })
  )

  return { projects }
}

exports.getProfitLossSummaryTable = async (query = {}) => {
  const { search, page = 1, limit = 10 } = query
  const dateFilter = buildDateFilter(query, 'date')
  const skip = (Math.max(parseInt(page, 10), 1) - 1) * parseInt(limit, 10)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)

  const leadFilter = { quoteValue: { $gt: 0 }, isTerminated: { $ne: true } }
  const bu = buildBusinessUnitFilter(query.businessUnit || query.company)
  if (bu) Object.assign(leadFilter, bu)
  if (query.projectId || query.leadId) leadFilter._id = query.projectId || query.leadId
  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    leadFilter.$or = [{ projectName: regex }, { jobId: regex }]
  }

  const [leads, total] = await Promise.all([
    Lead.find(leadFilter)
      .select('projectName jobId businessUnit lifecycleStatus')
      .sort({ projectName: 1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(leadFilter),
  ])

  const rows = await Promise.all(
    leads.map(async (lead) => {
      const pl = await buildPeriodPL({ leadId: lead._id }, dateFilter)
      const sales = pl.totalIncome
      return {
        leadId: lead._id,
        projectName: lead.projectName,
        jobId: lead.jobId,
        category: lead.businessUnit || lead.lifecycleStatus || 'General',
        salesUSD: round2(sales),
        cogsUSD: round2(pl.cogs),
        grossProfitUSD: round2(pl.grossProfit),
        grossMarginPct: marginPct(pl.grossProfit, sales),
      }
    })
  )

  return {
    rows,
    total,
    page: parseInt(page, 10) || 1,
    limit: parsedLimit,
  }
}
