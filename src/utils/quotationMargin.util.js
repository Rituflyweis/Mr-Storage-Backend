const mongoose = require('mongoose')
const Quotation = require('../models/Quotation')
const Lead = require('../models/Lead')
const { buildDateFilter } = require('./dateRange')
const { buildBusinessUnitFilter } = require('./businessUnit')
const { marginPct } = require('./profitLossPeriod.util')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Revenue & COGS from extracted quotation (plus optional profitAnalysis overrides). */
const resolveQuotationFinancials = (quotation, leadFallback = null) => {
  if (!quotation) {
    const revenue = round2(leadFallback?.quoteValue || 0)
    return {
      revenue,
      cogs: 0,
      grossProfit: revenue,
      operatingProfit: revenue,
      netProfit: revenue,
      quotationId: null,
    }
  }

  const pa = quotation.profitAnalysis || {}
  const revenue = round2(
    pa.revenueOverride != null && pa.revenueOverride !== ''
      ? Number(pa.revenueOverride)
      : Number(quotation.finalPrice || quotation.basePrice || leadFallback?.quoteValue || 0)
  )
  const material = Number(quotation.materialCost) || 0
  const freight = Number(quotation.freightCost) || 0
  const cogs = round2(
    pa.actualCostOverride != null && pa.actualCostOverride !== ''
      ? Number(pa.actualCostOverride)
      : Number(quotation.totalCOGS) || material + freight
  )
  const grossProfit = round2(revenue - cogs)
  return {
    revenue,
    cogs,
    grossProfit,
    operatingProfit: grossProfit,
    netProfit: grossProfit,
    quotationId: quotation._id,
    materialCost: round2(material),
    freightCost: round2(freight),
    markupValue: round2(Number(quotation.markupValue) || Math.max(0, revenue - cogs)),
  }
}

const buildLeadFilter = async (query = {}) => {
  const filter = { isTerminated: { $ne: true }, isArchived: { $ne: true } }
  const bu = buildBusinessUnitFilter(query.businessUnit || query.company)
  if (bu) Object.assign(filter, bu)
  if (query.projectId || query.leadId) {
    filter._id = new mongoose.Types.ObjectId(query.projectId || query.leadId)
  }
  if (query.search?.trim()) {
    const regex = new RegExp(query.search.trim(), 'i')
    filter.$or = [{ projectName: regex }, { jobId: regex }]
  }
  return filter
}

const resolveLeadIds = async (query) => {
  if (query.projectId || query.leadId) {
    return [new mongoose.Types.ObjectId(query.projectId || query.leadId)]
  }
  const filter = await buildLeadFilter(query)
  return Lead.find(filter).distinct('_id')
}

/** Latest quotation per lead (newest createdAt), optional proposalDate range. */
const getLatestQuotationByLead = async (leadIds, dateQuery = {}) => {
  if (!leadIds?.length) return new Map()

  const dateFilter = buildDateFilter(dateQuery, 'proposalDate')
  const match = { leadId: { $in: leadIds } }
  if (dateFilter.proposalDate) match.proposalDate = dateFilter.proposalDate

  const rows = await Quotation.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$leadId',
        doc: { $first: '$$ROOT' },
      },
    },
  ])

  const map = new Map()
  for (const row of rows) {
    map.set(String(row._id), row.doc)
  }
  return map
}

const portfolioRollup = (quotationByLead, leadById = new Map()) => {
  let revenue = 0
  let cogs = 0
  let count = 0

  for (const [leadKey, q] of quotationByLead) {
    const lead = leadById.get(leadKey) || leadById.get(String(q.leadId))
    const f = resolveQuotationFinancials(q, lead)
    if (f.revenue <= 0 && f.cogs <= 0) continue
    revenue += f.revenue
    cogs += f.cogs
    count += 1
  }

  const grossProfit = round2(revenue - cogs)
  const operatingProfit = grossProfit
  const netProfit = grossProfit
  const avgSellingPrice = count > 0 ? round2(revenue / count) : 0

  return {
    revenue: round2(revenue),
    cogs: round2(cogs),
    grossProfit,
    operatingProfit,
    netProfit,
    quotationCount: count,
    avgSellingPrice,
    grossMarginPct: marginPct(grossProfit, revenue),
    operatingMarginPct: marginPct(operatingProfit, revenue),
    netProfitMarginPct: marginPct(netProfit, revenue),
    contributionMarginPct: marginPct(revenue - cogs, revenue),
  }
}

/** All quotations in range (for trend), not deduped by lead. */
const listQuotationsInProposalRange = async (leadIds, dateQuery) => {
  if (!leadIds?.length) return []
  const dateFilter = buildDateFilter(dateQuery, 'proposalDate')
  const match = { leadId: { $in: leadIds } }
  if (dateFilter.proposalDate) match.proposalDate = dateFilter.proposalDate
  return Quotation.find(match)
    .select(
      'leadId proposalDate finalPrice basePrice materialCost freightCost totalCOGS markupValue profitAnalysis createdAt'
    )
    .lean()
}

module.exports = {
  round2,
  resolveQuotationFinancials,
  buildLeadFilter,
  resolveLeadIds,
  getLatestQuotationByLead,
  portfolioRollup,
  listQuotationsInProposalRange,
  marginPct,
}
