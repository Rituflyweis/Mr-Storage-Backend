const Tax = require('../../models/Tax')
const { buildDateFilter } = require('../../utils/dateRange')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getStats = asyncHandler(async (req, res) => {
  const now = new Date()
  const taxes = await Tax.find().lean()

  const pending  = taxes.filter(t => t.status === 'pending')
  const paid     = taxes.filter(t => t.status === 'paid')
  const overdue  = pending.filter(t => t.dueDate < now)

  const totalPayable = overdue.reduce((s, t) => s + t.amount, 0)
  const totalPaid    = paid.reduce((s, t) => s + t.amount, 0)

  return success(res, {
    totalPayable,
    totalPaid,
    pendingCount: pending.length,
    overdueCount: overdue.length,
    paidCount:    paid.length,
  })
})

exports.listTaxes = asyncHandler(async (req, res) => {
  const { status } = req.query
  const dateFilter = buildDateFilter(req.query, 'dueDate')
  const now = new Date()

  const filter = { ...dateFilter }
  if (status === 'overdue') {
    filter.status  = 'pending'
    filter.dueDate = { ...filter.dueDate, $lt: now }
  } else if (status) {
    filter.status = status
  }

  const taxes = await Tax.find(filter)
    .populate('createdBy', 'name email')
    .populate('paidBy', 'name email')
    .sort({ dueDate: 1 })
    .lean()

  const result = taxes.map(t => ({
    ...t,
    isOverdue: t.status === 'pending' && t.dueDate < now,
  }))

  return success(res, { taxes: result })
})

exports.createTax = asyncHandler(async (req, res) => {
  const { state, dueDate, amount, websiteLink } = req.body

  const tax = await Tax.create({
    state,
    dueDate,
    amount,
    websiteLink: websiteLink || null,
    createdBy:   req.user._id,
  })

  return created(res, { tax })
})

exports.markAsPaid = asyncHandler(async (req, res) => {
  const tax = await Tax.findById(req.params.taxId)
  if (!tax) return notFound(res, 'Tax entry not found')
  if (tax.status === 'paid') return badRequest(res, 'Tax entry already marked as paid')

  tax.status = 'paid'
  tax.paidAt = new Date()
  tax.paidBy = req.user._id
  await tax.save()

  return success(res, { tax }, 'Tax marked as paid')
})
