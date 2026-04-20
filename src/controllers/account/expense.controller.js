const Expense = require('../../models/Expense')
const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'date')

  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)

  const baseFilter = { isActive: true, ...dateFilter }

  const [allExpenses, thisMonthExpenses, lastMonthExpenses] = await Promise.all([
    Expense.find(baseFilter).select('category amount').lean(),
    Expense.find({ isActive: true, date: { $gte: thisMonthStart } }).select('amount').lean(),
    Expense.find({ isActive: true, date: { $gte: lastMonthStart, $lte: lastMonthEnd } }).select('amount').lean(),
  ])

  const totalAmount = allExpenses.reduce((s, e) => s + e.amount, 0)
  const totalCount  = allExpenses.length

  const categoryMap = {}
  for (const e of allExpenses) {
    if (!categoryMap[e.category]) categoryMap[e.category] = { total: 0, count: 0 }
    categoryMap[e.category].total += e.amount
    categoryMap[e.category].count += 1
  }
  const byCategory = Object.entries(categoryMap).map(([category, v]) => ({ category, ...v }))

  const thisMonth = thisMonthExpenses.reduce((s, e) => s + e.amount, 0)
  const lastMonth = lastMonthExpenses.reduce((s, e) => s + e.amount, 0)

  return success(res, { totalAmount, totalCount, byCategory, thisMonth, lastMonth })
})

exports.listExpenses = asyncHandler(async (req, res) => {
  const { category, leadId, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)
  const dateFilter = buildDateFilter(req.query, 'date')

  const filter = { isActive: true, ...dateFilter }
  if (category) filter.category = category
  if (leadId)   filter.leadId   = leadId

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('leadId')
      .populate('createdBy', 'name email')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Expense.countDocuments(filter),
  ])

  return success(res, { expenses, total, page: Number(page), limit: Number(limit) })
})

exports.createExpense = asyncHandler(async (req, res) => {
  const { expenseId, category, date, amount, description, leadId } = req.body

  if (leadId) {
    const lead = await Lead.findById(leadId).lean()
    if (!lead) return notFound(res, 'Lead not found')
  }

  const expense = await Expense.create({
    expenseId,
    category,
    date,
    amount,
    description,
    leadId:    leadId || null,
    createdBy: req.user._id,
  })

  return created(res, { expense })
})

exports.deactivateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.expenseId)
  if (!expense) return notFound(res, 'Expense not found')
  if (!expense.isActive) return badRequest(res, 'Expense is already deactivated')

  expense.isActive = false
  await expense.save()

  return success(res, { expense: { _id: expense._id, isActive: false } }, 'Expense deactivated')
})

exports.getProjectExpenses = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const [lead, expenses] = await Promise.all([
    Lead.findById(leadId).lean(),
    Expense.find({ leadId, isActive: true })
      .populate('createdBy', 'name email')
      .sort({ date: -1 })
      .lean(),
  ])

  if (!lead) return notFound(res, 'Lead not found')

  const total = expenses.reduce((s, e) => s + e.amount, 0)

  return success(res, { lead, expenses, total })
})
