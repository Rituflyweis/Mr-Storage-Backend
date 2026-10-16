/**
 * Admin Financial → Margin Analysis (quotation / COG extraction only).
 * Not used by the account panel — see accountMarginAnalysis.service.js.
 */
const mongoose = require('mongoose')
const Lead = require('../models/Lead')
const Quotation = require('../models/Quotation')
const { resolvePeriodRange, pctChange } = require('../utils/profitLossPeriod.util')
const {
  round2,
  resolveQuotationFinancials,
  loadEstimatesForQuotations,
  buildLeadFilter,
  resolveLeadIds,
  getLatestQuotationByLead,
  portfolioRollup,
  listQuotationsInProposalRange,
  marginPct,
} = require('../utils/quotationMargin.util')

const loadLeadsMap = async (leadIds) => {
  if (!leadIds?.length) return new Map()
  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select('projectName jobId businessUnit lifecycleStatus quoteValue')
    .lean()
  return new Map(leads.map((l) => [String(l._id), l]))
}

const financialsForQuote = (q, leadById, estimateById) => {
  const lead = leadById.get(String(q.leadId))
  const estimate = q.sourceEstimateId ? estimateById.get(String(q.sourceEstimateId)) : null
  return resolveQuotationFinancials(q, lead, estimate)
}

const rollupForPeriod = async (query, startDate, endDate) => {
  const leadIds = await resolveLeadIds(query)
  const quotationByLead = await getLatestQuotationByLead(leadIds, { startDate, endDate })
  const [leadById, estimateById] = await Promise.all([
    loadLeadsMap([...quotationByLead.keys()].map((id) => new mongoose.Types.ObjectId(id))),
    loadEstimatesForQuotations(quotationByLead),
  ])
  return portfolioRollup(quotationByLead, leadById, estimateById)
}

const resolveEffectiveDates = (query) => {
  const now = new Date()
  const resolved = !query.startDate && !query.endDate ? resolvePeriodRange(query.period, now) : null
  const startDate = query.startDate || resolved?.start?.toISOString()
  const endDate = query.endDate || resolved?.end?.toISOString()
  return { startDate, endDate }
}

exports.getMarginAnalysisSummary = async (query = {}) => {
  const { startDate, endDate } = resolveEffectiveDates(query)

  const periodEnd = endDate ? new Date(endDate) : new Date()
  const periodStart = startDate ? new Date(startDate) : new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1)
  const lengthMs = periodEnd.getTime() - periodStart.getTime()
  const prevEnd = new Date(periodStart.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - lengthMs)

  const [current, previous] = await Promise.all([
    rollupForPeriod(query, startDate, endDate),
    rollupForPeriod(query, prevStart.toISOString(), prevEnd.toISOString()),
  ])

  return {
    dataSource: 'quotation',
    audience: 'admin',
    grossMarginPct: current.grossMarginPct,
    operatingMarginPct: current.operatingMarginPct,
    netProfitMarginPct: current.netProfitMarginPct,
    contributionMarginPct: current.contributionMarginPct,
    avgSellingPrice: current.avgSellingPrice,
    period: { startDate, endDate },
    kpis: {
      grossMarginPct: {
        value: current.grossMarginPct,
        changePct: pctChange(current.grossMarginPct, previous.grossMarginPct),
      },
      operatingMarginPct: {
        value: current.operatingMarginPct,
        changePct: pctChange(current.operatingMarginPct, previous.operatingMarginPct),
      },
      netProfitMarginPct: {
        value: current.netProfitMarginPct,
        changePct: pctChange(current.netProfitMarginPct, previous.netProfitMarginPct),
      },
      contributionMarginPct: {
        value: current.contributionMarginPct,
        changePct: pctChange(current.contributionMarginPct, previous.contributionMarginPct),
      },
      avgSellingPrice: {
        value: current.avgSellingPrice,
        changePct: pctChange(current.avgSellingPrice, previous.avgSellingPrice),
      },
    },
    totals: {
      revenue: current.revenue,
      cogs: current.cogs,
      grossProfit: current.grossProfit,
      operatingProfit: current.operatingProfit,
      netProfit: current.netProfit,
      quotationCount: current.quotationCount,
    },
  }
}

const bucketKey = (date, period) => {
  const dt = new Date(date)
  if (Number.isNaN(dt.getTime())) return null
  if (period === 'year') return `${dt.getFullYear()}`
  if (period === 'quarter') return `${dt.getFullYear()}-Q${Math.ceil((dt.getMonth() + 1) / 3)}`
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

exports.getMarginTrendOverTime = async (query = {}) => {
  const { period = 'month' } = query
  if (!['month', 'quarter', 'year'].includes(period)) {
    return { error: 'period must be month, quarter, or year' }
  }

  const now = new Date()
  const rangeStart =
    period === 'year'
      ? new Date(now.getFullYear() - 4, 0, 1)
      : period === 'quarter'
        ? new Date(now.getFullYear() - 2, 0, 1)
        : new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const leadIds = await resolveLeadIds(query)
  const quotations = await listQuotationsInProposalRange(leadIds, {
    startDate: rangeStart.toISOString(),
    endDate: now.toISOString(),
  })
  const quotMap = new Map()
  for (const q of quotations) quotMap.set(String(q._id), q)
  const estimateById = await loadEstimatesForQuotations(quotMap)

  const buckets = new Map()
  for (const q of quotations) {
    const key = bucketKey(q.proposalDate || q.createdAt, period)
    if (!key) continue
    const f = financialsForQuote(q, new Map(), estimateById)
    const row = buckets.get(key) || { revenue: 0, cogs: 0 }
    row.revenue += f.revenue
    row.cogs += f.cogs
    buckets.set(key, row)
  }

  const trend = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { revenue, cogs }]) => {
      const grossProfit = revenue - cogs
      return {
        period: key,
        label: key,
        revenue: round2(revenue),
        expense: round2(cogs),
        cogs: round2(cogs),
        grossProfit: round2(grossProfit),
        grossMarginPct: marginPct(grossProfit, revenue),
        operatingMarginPct: marginPct(grossProfit, revenue),
        netProfitMarginPct: marginPct(grossProfit, revenue),
        contributionMarginPct: marginPct(revenue - cogs, revenue),
      }
    })

  return { period, dataSource: 'quotation', audience: 'admin', trend }
}

exports.getMarginByProjects = async (query = {}) => {
  const { startDate, endDate, limit = 10 } = query
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50)
  const leadIds = await resolveLeadIds(query)
  const quotationByLead = await getLatestQuotationByLead(leadIds, { startDate, endDate })
  const [leadById, estimateById] = await Promise.all([
    loadLeadsMap([...quotationByLead.keys()].map((id) => new mongoose.Types.ObjectId(id))),
    loadEstimatesForQuotations(quotationByLead),
  ])

  const projects = []
  for (const [, q] of quotationByLead) {
    const lead = leadById.get(String(q.leadId))
    const f = financialsForQuote(q, leadById, estimateById)
    if (f.revenue <= 0 && f.cogs <= 0) continue
    projects.push({
      leadId: q.leadId,
      quotationId: q._id,
      projectName: lead?.projectName || '',
      jobId: lead?.jobId || '',
      category: lead?.businessUnit || lead?.lifecycleStatus || '',
      revenue: f.revenue,
      cogs: f.cogs,
      expenses: f.cogs,
      labourInstallCost: f.labourInstallCost,
      grossProfit: f.grossProfit,
      grossMarginPct: f.grossMarginPct,
      markupPercent: f.markupPercent,
      marginFromQuotation: f.marginFromQuotation,
      operatingMarginPct: marginPct(f.operatingProfit, f.revenue),
      netProfitMarginPct: marginPct(f.netProfit, f.revenue),
      contributionMarginPct: marginPct(f.revenue - f.cogs, f.revenue),
    })
  }

  projects.sort((a, b) => b.revenue - a.revenue)
  return { dataSource: 'quotation', audience: 'admin', projects: projects.slice(0, parsedLimit) }
}

exports.getProfitLossSummaryTable = async (query = {}) => {
  const { search, page = 1, limit = 10, startDate, endDate } = query
  const skip = (Math.max(parseInt(page, 10), 1) - 1) * parseInt(limit, 10)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)

  const leadFilter = await buildLeadFilter(query)
  const scopedLeadIds = await Lead.find(leadFilter).distinct('_id')
  const quotedLeadIds = await Quotation.distinct('leadId', { leadId: { $in: scopedLeadIds } })

  const tableFilter = { _id: { $in: quotedLeadIds }, isTerminated: { $ne: true } }
  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    tableFilter.$or = [{ projectName: regex }, { jobId: regex }]
  }

  const [leads, total] = await Promise.all([
    Lead.find(tableFilter)
      .select('projectName jobId businessUnit lifecycleStatus quoteValue')
      .sort({ projectName: 1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(tableFilter),
  ])

  const quotationByLead = await getLatestQuotationByLead(
    leads.map((l) => l._id),
    { startDate, endDate }
  )
  const estimateById = await loadEstimatesForQuotations(quotationByLead)
  const leadById = new Map(leads.map((l) => [String(l._id), l]))

  const rows = leads.map((lead) => {
    const q = quotationByLead.get(String(lead._id))
    const f = financialsForQuote(q, leadById, estimateById)
    return {
      leadId: lead._id,
      quotationId: f.quotationId,
      projectName: lead.projectName,
      jobId: lead.jobId,
      category: lead.businessUnit || lead.lifecycleStatus || 'General',
      salesUSD: f.revenue,
      cogsUSD: f.cogs,
      grossProfitUSD: f.grossProfit,
      grossMarginPct: f.grossMarginPct,
      markupPercent: f.markupPercent,
      labourInstallCost: f.labourInstallCost,
    }
  })

  return {
    dataSource: 'quotation',
    audience: 'admin',
    rows,
    total,
    page: parseInt(page, 10) || 1,
    limit: parsedLimit,
  }
}
