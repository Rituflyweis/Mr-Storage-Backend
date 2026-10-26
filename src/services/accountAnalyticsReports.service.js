const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const { buildDateFilter } = require('../utils/dateRange')
const { isInvoiceOverdue } = require('../utils/invoiceScope')
const {
  aggregateProjectExpenses,
  aggregateProjectExpensesByLeadMap,
  round2,
} = require('../utils/projectExpenseAggregate.util')
const { buildFinancialLeadMatch } = require('../utils/financialProjectScope')

const CUSTOMER_INVOICE_MATCH = {
  invoiceType: { $nin: ['vendor', 'freight_carrier'] },
  status: { $ne: 'cancelled' },
}

const leadListFilter = (query = {}) => {
  const base = buildFinancialLeadMatch()
  if (!query.search?.trim()) return base
  const regex = new RegExp(String(query.search).trim(), 'i')
  return { $and: [base, { $or: [{ projectName: regex }, { jobId: regex }] }] }
}

const categoryCardsFromRollup = (rollup) => {
  const c = rollup.categories || {}
  return [
    { key: 'materialCost', label: 'Material Cost', amount: c.materialCost || 0, color: 'blue' },
    { key: 'manpowerCost', label: 'Manpower Cost', amount: c.manpowerCost || 0, color: 'green' },
    {
      key: 'logisticsCost',
      label: 'Freight & Logistics',
      amount: c.logisticsCost || 0,
      color: 'orange',
    },
    { key: 'siteCost', label: 'Site/Project Expense', amount: c.siteCost || 0, color: 'purple' },
    {
      key: 'administrativeCost',
      label: 'Administrative Expense',
      amount: (c.administrativeCost || 0) + (c.miscellaneous || 0),
      color: 'pink',
    },
  ]
}

exports.getProjectWiseExpense = async (query = {}) => {
  const expenseDateFilter = buildDateFilter(query, 'date')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10))
  const skip = (page - 1) * limit

  const leadFilter = leadListFilter(query)
  const [total, leads] = await Promise.all([
    Lead.countDocuments(leadFilter),
    Lead.find(leadFilter)
      .select('projectName jobId quoteValue lifecycleStatus')
      .sort({ projectName: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ])

  const leadIds = leads.map((l) => l._id)
  const [expenseByLead, portfolioRollup] = await Promise.all([
    aggregateProjectExpensesByLeadMap(leadIds, expenseDateFilter),
    aggregateProjectExpenses(
      await Lead.find(leadFilter).distinct('_id'),
      expenseDateFilter
    ),
  ])

  const rows = leads.map((l) => {
    const key = String(l._id)
    const e = expenseByLead.get(key) || {
      totalExpense: 0,
      approvedExpense: 0,
      pendingApproval: 0,
      budgetedExpense: 0,
      budgetVariance: 0,
      variancePct: 0,
      vendorMaterialFromBids: 0,
      manualExpenseTotal: 0,
      freightFromBids: 0,
    }
    return {
      leadId: l._id,
      projectName: l.projectName,
      projectId: l.jobId,
      status: l.lifecycleStatus,
      totalExpense: e.totalExpense,
      approvedExpense: e.approvedExpense,
      pendingApproval: e.pendingApproval,
      budgetedExpense: e.budgetedExpense,
      budgetVariance: e.budgetVariance,
      variancePct: e.variancePct,
      sources: {
        manualExpenses: e.manualExpenseTotal,
        vendorMaterialFromEmailBids: e.vendorMaterialFromBids,
        freightFromEmailBids: e.freightFromBids,
      },
    }
  })

  const now = new Date()
  const months = Math.min(12, Math.max(1, Number(query.months) || 6))
  const monthlyOverview = []
  for (let m = months - 1; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const monthRollup = await aggregateProjectExpenses(
      await Lead.find(leadFilter).distinct('_id'),
      { date: { $gte: start, $lte: end } }
    )
    monthlyOverview.push({
      label,
      totalExpense: monthRollup.totalExpense,
      approvedExpense: monthRollup.approvedExpense,
      pendingApproval: monthRollup.pendingApproval,
    })
  }

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  const thisMonthRollup = await aggregateProjectExpenses(
    await Lead.find(leadFilter).distinct('_id'),
    { date: { $gte: thisMonthStart, $lte: thisMonthEnd } }
  )

  return {
    summary: {
      totalExpense: portfolioRollup.totalExpense,
      approvedExpense: portfolioRollup.approvedExpense,
      pendingApproval: portfolioRollup.pendingApproval,
      budgetedExpense: portfolioRollup.budgetedExpense,
      budgetVariance: portfolioRollup.budgetVariance,
      sources: {
        manualExpenses: portfolioRollup.manualExpenseTotal,
        vendorMaterialFromEmailBids: portfolioRollup.vendorMaterialFromBids,
        freightFromEmailBids: portfolioRollup.freightFromBids,
      },
    },
    expenseOverviewChart: monthlyOverview,
    expenseByCategoryThisMonth: categoryCardsFromRollup(thisMonthRollup),
    topExpenseCategoriesThisMonth: categoryCardsFromRollup(thisMonthRollup),
    rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

exports.getProjectWiseIncome = async (query = {}) => {
  const invoiceDateFilter = buildDateFilter(query, 'date')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10))
  const skip = (page - 1) * limit

  const leadFilter = leadListFilter(query)
  const [total, leads] = await Promise.all([
    Lead.countDocuments(leadFilter),
    Lead.find(leadFilter)
      .select('projectName jobId quoteValue lifecycleStatus')
      .sort({ projectName: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ])

  const allLeadIds = await Lead.find(leadFilter).distinct('_id')
  const invoices = await Invoice.find({
    leadId: { $in: allLeadIds },
    ...CUSTOMER_INVOICE_MATCH,
    ...invoiceDateFilter,
  })
    .select('leadId totalAmount status dueDate date daysToPay paidAt')
    .lean()

  const sumByLead = (predicate) => {
    const map = new Map()
    for (const inv of invoices) {
      if (!predicate(inv)) continue
      const key = String(inv.leadId)
      map.set(key, (map.get(key) || 0) + (inv.totalAmount || 0))
    }
    return map
  }

  const now = new Date()
  const totalByLead = sumByLead(() => true)
  const receivedByLead = sumByLead((inv) => inv.status === 'paid')
  const overdueByLead = sumByLead((inv) => isInvoiceOverdue(inv, now))
  const pendingByLead = sumByLead(
    (inv) => inv.status !== 'paid' && !isInvoiceOverdue(inv, now)
  )

  let portfolioTotal = 0
  let portfolioReceived = 0
  let portfolioPending = 0
  let portfolioOverdue = 0
  for (const inv of invoices) {
    portfolioTotal += inv.totalAmount || 0
    if (inv.status === 'paid') portfolioReceived += inv.totalAmount || 0
    else if (isInvoiceOverdue(inv, now)) portfolioOverdue += inv.totalAmount || 0
    else portfolioPending += inv.totalAmount || 0
  }

  const rows = leads.map((l) => {
    const key = String(l._id)
    const totalIncome = totalByLead.get(key) || 0
    const receivedIncome = receivedByLead.get(key) || 0
    const pendingIncome = pendingByLead.get(key) || 0
    const overdueIncome = overdueByLead.get(key) || 0
    const receivedPct = totalIncome > 0 ? round2((receivedIncome / totalIncome) * 100) : 0
    return {
      leadId: l._id,
      projectName: l.projectName,
      projectId: l.jobId,
      totalIncome,
      receivedIncome,
      pendingIncome,
      overdueIncome,
      receivedPct,
    }
  })

  const months = Math.min(12, Math.max(1, Number(query.months) || 6))
  const monthlyOverview = []
  for (let m = months - 1; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const monthInvs = invoices.filter(
      (inv) => inv.date && new Date(inv.date) >= start && new Date(inv.date) <= end
    )
    let totalIncome = 0
    let receivedIncome = 0
    let pendingIncome = 0
    for (const inv of monthInvs) {
      totalIncome += inv.totalAmount || 0
      if (inv.status === 'paid') receivedIncome += inv.totalAmount || 0
      else pendingIncome += inv.totalAmount || 0
    }
    monthlyOverview.push({ label, totalIncome, receivedIncome, pendingIncome })
  }

  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const thisMonthInvs = invoices.filter(
    (inv) => inv.date && new Date(inv.date) >= thisMonthStart
  )
  const incomeByProjectThisMonth = leads.map((l) => {
    const key = String(l._id)
    const amount = thisMonthInvs
      .filter((inv) => String(inv.leadId) === key)
      .reduce((s, inv) => s + (inv.totalAmount || 0), 0)
    return { leadId: l._id, projectName: l.projectName, amount }
  })
  const monthTotal = incomeByProjectThisMonth.reduce((s, r) => s + r.amount, 0)
  const donut = incomeByProjectThisMonth
    .filter((r) => r.amount > 0)
    .map((r) => ({
      ...r,
      pct: monthTotal > 0 ? round2((r.amount / monthTotal) * 100) : 0,
    }))

  return {
    summary: {
      totalIncome: round2(portfolioTotal),
      receivedIncome: round2(portfolioReceived),
      pendingIncome: round2(portfolioPending),
      overdueIncome: round2(portfolioOverdue),
    },
    incomeOverviewChart: monthlyOverview,
    incomeByProjectThisMonth: { total: round2(monthTotal), segments: donut },
    rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}
