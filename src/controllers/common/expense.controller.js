const Expense = require('../../models/Expense')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.listExpenses = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, category, leadId, dateFrom, dateTo } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = {}
  if (category) filter.category = category
  if (leadId)   filter.leadId   = leadId

  if (dateFrom || dateTo) {
    filter.incurredAt = {}
    if (dateFrom) {
      const d = new Date(dateFrom)
      if (!isNaN(d)) filter.incurredAt.$gte = d
    }
    if (dateTo) {
      const d = new Date(dateTo)
      if (!isNaN(d)) { d.setHours(23, 59, 59, 999); filter.incurredAt.$lte = d }
    }
  }

  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .sort({ incurredAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Expense.countDocuments(filter),
  ])

  return success(res, { expenses, total, page: Number(page), limit: Number(limit) })
})

exports.createExpense = asyncHandler(async (req, res) => {
  const { amountCents, category, description, incurredAt, vendor, receiptFileKey, leadId } = req.body

  if (leadId) {
    const lead = await Lead.findById(leadId).lean()
    if (!lead) return notFound(res, 'Lead not found')
  }

  const expense = await Expense.create({
    amountCents,
    category,
    description,
    incurredAt,
    vendor,
    receiptFileKey: receiptFileKey || null,
    leadId: leadId || null,
    createdBy: req.user._id,
  })

  return created(res, { expense })
})

exports.getExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id).lean()
  if (!expense) return notFound(res, 'Expense not found')
  return success(res, { expense })
})

exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id)
  if (!expense) return notFound(res, 'Expense not found')

  const ALLOWED = ['amountCents', 'category', 'description', 'incurredAt', 'vendor', 'receiptFileKey', 'leadId']
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) expense[key] = req.body[key] ?? null
  }

  // Validate leadId if being set to a non-null value
  if (expense.leadId) {
    const lead = await Lead.findById(expense.leadId).lean()
    if (!lead) return notFound(res, 'Lead not found')
  }

  await expense.save()
  return success(res, { expense })
})

exports.deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findByIdAndDelete(req.params.id)
  if (!expense) return notFound(res, 'Expense not found')
  return success(res, {}, 'Expense deleted')
})
