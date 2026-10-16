const mongoose = require('mongoose')
const Quotation = require('../models/Quotation')
const EstimateQuote = require('../models/EstimateQuote')
const Lead = require('../models/Lead')
const { buildDateFilter } = require('./dateRange')
const { buildBusinessUnitFilter } = require('./businessUnit')
const { marginPct } = require('./profitLossPeriod.util')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Revenue, COGS, margin % from Quotation + linked EstimateQuote (COG extraction). */
const resolveQuotationFinancials = (quotation, leadFallback = null, estimate = null) => {
  if (!quotation) {
    const revenue = round2(leadFallback?.quoteValue || 0)
    return {
      revenue,
      cogs: 0,
      grossProfit: revenue,
      operatingProfit: revenue,
      netProfit: revenue,
      quotationId: null,
      grossMarginPct: marginPct(revenue, revenue),
      markupPercent: 0,
      marginFromQuotation: 0,
      labourInstallCost: 0,
    }
  }

  const pa = quotation.profitAnalysis || {}
  const fq = estimate?.fullQuoteResult || {}
  const pricing = fq.pricing || estimate?.pricingResult || {}

  const material = num(quotation.materialCost || estimate?.materialCost)
  const freight = num(quotation.freightCost || estimate?.freightCost)
  const labourInstallCost = round2(num(estimate?.installCost ?? pricing.instCost ?? pricing.installCost))

  const revenue = round2(
    pa.revenueOverride != null && pa.revenueOverride !== ''
      ? num(pa.revenueOverride)
      : num(
          quotation.finalPrice ||
            quotation.basePrice ||
            fq.grandTotal ||
            estimate?.totalSell ||
            pricing.totSell ||
            leadFallback?.quoteValue
        )
  )

  const cogs = round2(
    pa.actualCostOverride != null && pa.actualCostOverride !== ''
      ? num(pa.actualCostOverride)
      : num(
          quotation.totalCOGS ||
            estimate?.totalCOGS ||
            pricing.totCost ||
            material + freight + labourInstallCost
        ) || material + freight
  )

  const grossProfit = round2(revenue - cogs)
  const markupValue = round2(num(quotation.markupValue) || Math.max(0, revenue - cogs))
  const markupPercent = num(quotation.markupPercent)

  const marginFromQuotation = num(
    quotation.margin ||
      fq.grandMargin ||
      estimate?.marginPercent ||
      pricing.profPct ||
      markupPercent
  )

  const grossMarginPct =
    marginFromQuotation > 0 ? round2(marginFromQuotation) : marginPct(grossProfit, revenue)

  return {
    revenue,
    cogs,
    grossProfit,
    operatingProfit: grossProfit,
    netProfit: grossProfit,
    quotationId: quotation._id,
    materialCost: round2(material),
    freightCost: round2(freight),
    labourInstallCost,
    markupValue,
    markupPercent,
    marginFromQuotation: round2(marginFromQuotation),
    grossMarginPct,
  }
}

const loadEstimatesForQuotations = async (quotationByLead) => {
  const estimateIds = [...quotationByLead.values()]
    .map((q) => q.sourceEstimateId)
    .filter(Boolean)
  if (!estimateIds.length) return new Map()
  const rows = await EstimateQuote.find({ _id: { $in: estimateIds } })
    .select(
      'totalSell totalCOGS materialCost freightCost installCost marginPercent profit fullQuoteResult pricingResult'
    )
    .lean()
  return new Map(rows.map((e) => [String(e._id), e]))
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

const portfolioRollup = (quotationByLead, leadById = new Map(), estimateById = new Map()) => {
  let revenue = 0
  let cogs = 0
  let count = 0

  for (const [leadKey, q] of quotationByLead) {
    const lead = leadById.get(leadKey) || leadById.get(String(q.leadId))
    const estimate = q.sourceEstimateId ? estimateById.get(String(q.sourceEstimateId)) : null
    const f = resolveQuotationFinancials(q, lead, estimate)
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
      'leadId sourceEstimateId proposalDate finalPrice basePrice margin markupPercent materialCost freightCost totalCOGS markupValue profitAnalysis createdAt'
    )
    .lean()
}

module.exports = {
  round2,
  resolveQuotationFinancials,
  loadEstimatesForQuotations,
  buildLeadFilter,
  resolveLeadIds,
  getLatestQuotationByLead,
  portfolioRollup,
  listQuotationsInProposalRange,
  marginPct,
}
