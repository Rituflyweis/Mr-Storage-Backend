const Invoice = require('../../models/Invoice')
const Expense = require('../../models/Expense')
const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getProfitLoss = asyncHandler(async (req, res) => {
  const { leadId, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const skip = (Number(page) - 1) * Number(limit)

  const invoiceFilter = { ...dateFilter }
  if (leadId) invoiceFilter.leadId = leadId

  const [invoices, total] = await Promise.all([
    Invoice.find(invoiceFilter)
      .select('leadId totalAmount status createdAt paidAt invoiceNumber')
      .populate('leadId', 'projectName jobId lifecycleStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Invoice.countDocuments(invoiceFilter),
  ])

  const leadIds = [...new Set(invoices.map((i) => String(i.leadId?._id)).filter(Boolean))]
  const expenses = await Expense.find({
    leadId: { $in: leadIds },
    isActive: true,
  }).select('leadId amount').lean()

  const expByLead = {}
  for (const e of expenses) {
    const key = String(e.leadId)
    expByLead[key] = (expByLead[key] || 0) + e.amount
  }

  const rows = invoices.map((inv) => {
    const key = String(inv.leadId?._id)
    const expense = expByLead[key] || 0
    const revenue = inv.totalAmount
    const netProfit = revenue - expense
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 100 * 10) / 10 : 0

    return {
      orderId: inv._id,
      invoiceNumber: inv.invoiceNumber || '',
      projectName: inv.leadId?.projectName || '',
      projectId: inv.leadId?.jobId || '',
      revenue,
      expense,
      netProfit,
      margin,
      status: inv.status,
      date: inv.createdAt,
    }
  })

  const allInvoices = await Invoice.find(dateFilter).select('totalAmount status').lean()
  const allExpenses = await Expense.find({
    isActive: true,
    ...buildDateFilter(req.query, 'date'),
  }).select('amount category').lean()

  const totalRevenue = allInvoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalExpense = allExpenses.reduce((s, e) => s + e.amount, 0)
  const netProfit = totalRevenue - totalExpense
  const avgMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100 * 10) / 10 : 0

  const byCategory = {}
  for (const e of allExpenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
  }

  const now = new Date()
  const monthlyTrend = []
  for (let m = 5; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const label = start.toLocaleDateString('en-US', { month: 'short' })

    const [mInvs, mExps] = await Promise.all([
      Invoice.find({ createdAt: { $gte: start, $lte: end } }).select('totalAmount').lean(),
      Expense.find({ isActive: true, date: { $gte: start, $lte: end } }).select('amount').lean(),
    ])
    const mRevenue = mInvs.reduce((s, i) => s + i.totalAmount, 0)
    const mExpense = mExps.reduce((s, e) => s + e.amount, 0)
    monthlyTrend.push({ label, revenue: mRevenue, expense: mExpense, profit: mRevenue - mExpense })
  }

  return success(res, {
    rows,
    total,
    summary: { totalRevenue, totalExpense, netProfit, avgMargin },
    expenseByCategory: byCategory,
    monthlyTrend,
  })
})

exports.getCashFlow = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const now = new Date()

  const points = []
  for (let m = 11; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    const [inflows, outflows] = await Promise.all([
      Invoice.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).select('totalAmount').lean(),
      Expense.find({ isActive: true, date: { $gte: start, $lte: end } }).select('amount').lean(),
    ])

    const inflow = inflows.reduce((s, i) => s + i.totalAmount, 0)
    const outflow = outflows.reduce((s, e) => s + e.amount, 0)
    points.push({ label, inflow, outflow, net: inflow - outflow })
  }

  const totalInflow = points.reduce((s, p) => s + p.inflow, 0)
  const totalOutflow = points.reduce((s, p) => s + p.outflow, 0)

  return success(res, {
    points,
    summary: { totalInflow, totalOutflow, netCashFlow: totalInflow - totalOutflow },
  })
})
