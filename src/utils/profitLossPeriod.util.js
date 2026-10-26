const Invoice = require('../models/Invoice')
const Expense = require('../models/Expense')
const Tax = require('../models/Tax')
const Lead = require('../models/Lead')
const { aggregateEmailBidExpenses } = require('./projectExpenseAggregate.util')
const { buildFinancialLeadMatch } = require('./financialProjectScope')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const resolveLeadIdsFromFilter = async (filter = {}) => {
  if (filter.leadId) {
    if (filter.leadId.$in) return filter.leadId.$in
    return [filter.leadId]
  }
  return Lead.find(buildFinancialLeadMatch()).distinct('_id')
}

const COGS_CATEGORY_NAMES = ['Vendor/Freight', 'materials', 'labour', 'Materials', 'Labour']

const splitExpenseBreakdown = (byCategory) => {
  const get = (names) =>
    byCategory.filter((c) => names.includes(c._id)).reduce((s, c) => s + c.total, 0)
  const directCosts = get(['Vendor/Freight', 'materials', 'labour', 'Materials', 'Labour'])
  const indirectCosts = get(['Operations', 'transport', 'logistics', 'equipment'])
  const administrativeExpenses = get(['Salaries', 'Marketing', 'administrative'])
  const known = directCosts + indirectCosts + administrativeExpenses
  const total = byCategory.reduce((s, c) => s + c.total, 0)
  const otherExpenses = Math.max(0, total - known)
  return { directCosts, indirectCosts, administrativeExpenses, otherExpenses, totalExpenses: total }
}

const sumCogsFromCategories = (byCategory) =>
  byCategory
    .filter((c) => COGS_CATEGORY_NAMES.includes(c._id))
    .reduce((s, c) => s + c.total, 0)

const buildPeriodPL = async (filter, dateFilter) => {
  const [incomeAgg, expenseByCategory, taxAgg, invoiceCountAgg] = await Promise.all([
    Invoice.aggregate([
      { $match: { ...filter, ...dateFilter, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Expense.aggregate([
      { $match: { ...filter, ...dateFilter, isActive: true } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]),
    Tax.aggregate([
      { $match: { ...dateFilter, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, ...dateFilter, status: 'paid' } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
  ])

  const projectRevenue = incomeAgg[0]?.total || 0
  const otherIncome = 0
  const totalIncome = projectRevenue + otherIncome
  const expenseBreakdown = splitExpenseBreakdown(expenseByCategory)
  const manualDirect = expenseBreakdown.directCosts
  const manualTotal = expenseBreakdown.totalExpenses

  const leadIds = await resolveLeadIdsFromFilter(filter)
  const bidCosts = await aggregateEmailBidExpenses(leadIds)
  const bidDirect = bidCosts.vendorMaterialFromBids + bidCosts.freightFromBids
  expenseBreakdown.directCosts = round2(manualDirect + bidDirect)
  expenseBreakdown.totalExpenses = round2(manualTotal + bidDirect)

  const cogs = round2((sumCogsFromCategories(expenseByCategory) || manualDirect) + bidDirect)
  const operatingExpenses = Math.max(0, expenseBreakdown.totalExpenses - cogs)
  const grossProfit = totalIncome - cogs
  const operatingProfit = totalIncome - expenseBreakdown.totalExpenses
  const taxExpense = taxAgg[0]?.total || 0
  const netProfit = operatingProfit - taxExpense
  const paidInvoiceCount = invoiceCountAgg[0]?.count || 0

  return {
    projectRevenue,
    otherIncome,
    totalIncome,
    expenseBreakdown,
    cogs,
    operatingExpenses,
    grossProfit,
    operatingProfit,
    taxExpense,
    netProfit,
    paidInvoiceCount,
  }
}

const variance = (current, previous) => {
  const amount = current - previous
  const pct = previous !== 0 ? Math.round((amount / Math.abs(previous)) * 100 * 100) / 100 : 0
  return { amount, pct }
}

const resolvePeriodRange = (period, now = new Date()) => {
  if (period === 'yearly') return { start: new Date(now.getFullYear(), 0, 1), end: now }
  if (period === 'quarterly') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3
    return { start: new Date(now.getFullYear(), qStartMonth, 1), end: now }
  }
  if (period === 'monthly') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now }
  return null
}

const pctChange = (current, previous) => {
  if (!previous || previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / Math.abs(previous)) * 100 * 10) / 10
}

const marginPct = (numerator, revenue) =>
  revenue > 0 ? Math.round((numerator / revenue) * 100 * 100) / 100 : 0

module.exports = {
  splitExpenseBreakdown,
  buildPeriodPL,
  variance,
  resolvePeriodRange,
  pctChange,
  marginPct,
  sumCogsFromCategories,
}
