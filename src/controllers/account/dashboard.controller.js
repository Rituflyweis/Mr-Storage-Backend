const Invoice = require('../../models/Invoice')
const Expense = require('../../models/Expense')
const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const computeDueDate = (inv) => {
  if (!inv.daysToPay || !inv.date) return null
  return new Date(new Date(inv.date).getTime() + inv.daysToPay * 24 * 60 * 60 * 1000)
}

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const [invoices, expenses] = await Promise.all([
    Invoice.find(dateFilter).select('status totalAmount').lean(),
    Expense.find({ isActive: true, ...buildDateFilter(req.query, 'date') }).select('amount').lean(),
  ])

  const totalRevenue  = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const outstanding   = invoices.filter(i => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + i.totalAmount, 0)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const netProfit     = totalRevenue - totalExpenses

  return success(res, { totalRevenue, totalExpenses, netProfit, outstanding })
})

exports.getInvoiceStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const invoices = await Invoice.find(dateFilter).select('status totalAmount').lean()

  const paid    = invoices.filter(i => i.status === 'paid')
  const overdue = invoices.filter(i => i.status === 'overdue')
  const unpaid  = invoices.filter(i => ['draft', 'sent'].includes(i.status))

  return success(res, {
    total:      invoices.length,
    paid:       paid.length,
    unpaid:     unpaid.length,
    overdue:    overdue.length,
    totalSales: paid.reduce((s, i) => s + i.totalAmount, 0),
  })
})

exports.getIncomeVsExpense = asyncHandler(async (req, res) => {
  const { period = 'monthly' } = req.query
  const now = new Date()
  const points = []

  if (period === 'weekly') {
    for (let w = 7; w >= 0; w--) {
      const end   = new Date(now); end.setDate(now.getDate() - w * 7); end.setHours(23, 59, 59, 999)
      const start = new Date(end); start.setDate(end.getDate() - 6);   start.setHours(0, 0, 0, 0)
      const label = `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

      const [invoices, expenses] = await Promise.all([
        Invoice.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).select('totalAmount').lean(),
        Expense.find({ isActive: true, date: { $gte: start, $lte: end } }).select('amount').lean(),
      ])
      points.push({
        label,
        income:  invoices.reduce((s, i) => s + i.totalAmount, 0),
        expense: expenses.reduce((s, e) => s + e.amount, 0),
      })
    }
  } else if (period === 'yearly') {
    for (let y = 2; y >= 0; y--) {
      const year  = now.getFullYear() - y
      const start = new Date(year, 0, 1)
      const end   = new Date(year, 11, 31, 23, 59, 59, 999)

      const [invoices, expenses] = await Promise.all([
        Invoice.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).select('totalAmount').lean(),
        Expense.find({ isActive: true, date: { $gte: start, $lte: end } }).select('amount').lean(),
      ])
      points.push({
        label:   String(year),
        income:  invoices.reduce((s, i) => s + i.totalAmount, 0),
        expense: expenses.reduce((s, e) => s + e.amount, 0),
      })
    }
  } else {
    // monthly — last 12 months
    for (let m = 11; m >= 0; m--) {
      const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
      const end   = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
      const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

      const [invoices, expenses] = await Promise.all([
        Invoice.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).select('totalAmount').lean(),
        Expense.find({ isActive: true, date: { $gte: start, $lte: end } }).select('amount').lean(),
      ])
      points.push({
        label,
        income:  invoices.reduce((s, i) => s + i.totalAmount, 0),
        expense: expenses.reduce((s, e) => s + e.amount, 0),
      })
    }
  }

  return success(res, { period, points })
})

exports.getRecentTransactions = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50)

  const [invoices, expenses] = await Promise.all([
    Invoice.find({ status: 'paid' }).sort({ paidAt: -1 }).limit(limit).lean(),
    Expense.find({ isActive: true }).sort({ date: -1 }).limit(limit).lean(),
  ])

  const transactions = [
    ...invoices.map(i => ({ type: 'invoice', date: i.paidAt,  amount: i.totalAmount, ...i })),
    ...expenses.map(e => ({ type: 'expense', date: e.date,    amount: e.amount,      ...e })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)

  return success(res, { transactions })
})

exports.getUpcomingPayments = asyncHandler(async (req, res) => {
  const now     = new Date()
  const inTen   = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000)

  const invoices = await Invoice.find({ status: { $in: ['sent', 'draft'] } })
    .populate('leadId', 'buildingType location lifecycleStatus')
    .lean()

  const upcoming = invoices
    .map(i => ({ ...i, dueDate: computeDueDate(i) }))
    .filter(i => i.dueDate && i.dueDate >= now && i.dueDate <= inTen)
    .sort((a, b) => a.dueDate - b.dueDate)

  return success(res, { upcoming })
})

exports.getPaymentDistribution = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const invoices = await Invoice.find(dateFilter).select('status totalAmount').lean()

  const totalAmount = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalCount  = invoices.length

  const pct = (amount) => totalAmount ? Math.round((amount / totalAmount) * 100) : 0

  const paid    = invoices.filter(i => i.status === 'paid')
  const pending = invoices.filter(i => ['draft', 'sent'].includes(i.status))
  const overdue = invoices.filter(i => i.status === 'overdue')

  const paidAmt    = paid.reduce((s, i) => s + i.totalAmount, 0)
  const pendingAmt = pending.reduce((s, i) => s + i.totalAmount, 0)
  const overdueAmt = overdue.reduce((s, i) => s + i.totalAmount, 0)

  return success(res, {
    paid:    { count: paid.length,    amount: paidAmt,    pct: pct(paidAmt) },
    pending: { count: pending.length, amount: pendingAmt, pct: pct(pendingAmt) },
    overdue: { count: overdue.length, amount: overdueAmt, pct: pct(overdueAmt) },
    totalAmount,
    totalCount,
  })
})

exports.getRevenueTrend = asyncHandler(async (req, res) => {
  const now = new Date()
  const points = []

  for (let m = 11; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end   = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const month = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    const invoices = await Invoice.find({ status: 'paid', paidAt: { $gte: start, $lte: end } }).select('totalAmount').lean()
    points.push({ month, amount: invoices.reduce((s, i) => s + i.totalAmount, 0) })
  }

  return success(res, { points })
})

exports.getExpenseTrend = asyncHandler(async (req, res) => {
  const now = new Date()
  const points = []

  for (let m = 11; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end   = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const month = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

    const expenses = await Expense.find({ isActive: true, date: { $gte: start, $lte: end } }).select('amount').lean()
    points.push({ month, amount: expenses.reduce((s, e) => s + e.amount, 0) })
  }

  return success(res, { points })
})

exports.getCostBreakdown = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'date')
  const expenses = await Expense.find({ isActive: true, ...dateFilter }).select('amount category').lean()

  const breakdown = { material: 0, labour: 0, logistics: 0, other: 0 }
  for (const e of expenses) {
    if (e.category === 'materials') breakdown.material += e.amount
    else if (e.category === 'labour') breakdown.labour += e.amount
    else if (['transport', 'equipment'].includes(e.category)) breakdown.logistics += e.amount
    else breakdown.other += e.amount
  }
  const total = Object.values(breakdown).reduce((s, v) => s + v, 0)

  return success(res, { breakdown, total })
})

exports.getWipProjects = asyncHandler(async (req, res) => {
  const leads = await Lead.find({
    lifecycleStatus: { $in: ['po_received', 'in_production', 'dispatched'] },
    isTerminated: { $ne: true },
  }).select('_id projectName jobId lifecycleStatus').limit(10).lean()

  const leadIds = leads.map((l) => l._id)
  const [invoices, expenses] = await Promise.all([
    Invoice.find({ leadId: { $in: leadIds } }).select('leadId totalAmount status').lean(),
    Expense.find({ leadId: { $in: leadIds }, isActive: true }).select('leadId amount').lean(),
  ])

  const invMap = {}
  for (const i of invoices) {
    const key = String(i.leadId)
    invMap[key] = (invMap[key] || 0) + i.totalAmount
  }
  const expMap = {}
  for (const e of expenses) {
    const key = String(e.leadId)
    expMap[key] = (expMap[key] || 0) + e.amount
  }

  const projects = leads.map((lead) => {
    const key = String(lead._id)
    const revenue = invMap[key] || 0
    const totalCost = expMap[key] || 0
    const netProfit = revenue - totalCost
    const profitMargin = revenue > 0 ? Math.round((netProfit / revenue) * 100 * 10) / 10 : 0
    return {
      leadId: lead._id,
      projectName: lead.projectName,
      jobId: lead.jobId,
      lifecycleStatus: lead.lifecycleStatus,
      revenue,
      totalCost,
      netProfit,
      profitMargin,
    }
  })

  return success(res, { projects })
})
