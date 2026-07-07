const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound } = require('../../utils/apiResponse')
const { buildDateFilter } = require('../../utils/dateRange')

exports.getInvoiceReport = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const filter = { ...dateFilter }
  if (status && status !== 'All') filter.status = status
  if (projectId) filter.leadId = projectId

  const now = new Date()

  const [total, paid, unpaid, overdue, invoices, count] = await Promise.all([
    Invoice.aggregate([
      { $match: filter },
      { $group: { _id: null, sum: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, status: 'paid' } },
      { $group: { _id: null, sum: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, status: { $in: ['sent', 'draft'] } } },
      { $group: { _id: null, sum: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, status: 'overdue' } },
      { $group: { _id: null, sum: { $sum: '$totalAmount' } } },
    ]),
    Invoice.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'customerId', select: 'firstName lastName' })
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Invoice.countDocuments(filter),
  ])

  return success(res, {
    stats: {
      totalAmount:   total[0]?.sum || 0,
      totalPaid:     paid[0]?.sum || 0,
      totalUnpaid:   unpaid[0]?.sum || 0,
      overdue:       overdue[0]?.sum || 0,
    },
    invoices,
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

exports.getVendorInvoices = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, page = 1, limit = 20, search } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const filter = { invoiceType: 'vendor', ...dateFilter }
  if (status && status !== 'All') filter.status = status
  if (projectId) filter.leadId = projectId
  if (search) filter.$or = [{ invoiceNumber: { $regex: search, $options: 'i' } }]

  const [invoices, count, stats] = await Promise.all([
    Invoice.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: { invoiceType: 'vendor', ...dateFilter } },
      { $group: {
        _id: null,
        totalIncome:    { $sum: '$totalAmount' },
        productSales:   { $sum: { $cond: [{ $eq: ['$category', 'product'] }, '$totalAmount', 0] } },
        serviceRevenue: { $sum: { $cond: [{ $eq: ['$category', 'service'] }, '$totalAmount', 0] } },
        otherIncome:    { $sum: { $cond: [{ $eq: ['$category', 'other'] }, '$totalAmount', 0] } },
      }},
    ]),
  ])

  const s = stats[0] || {}
  return success(res, {
    stats: {
      totalIncome:    s.totalIncome || 0,
      productSales:   s.productSales || 0,
      serviceRevenue: s.serviceRevenue || 0,
      otherIncome:    s.otherIncome || 0,
    },
    invoices,
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

exports.getFreightCarrierInvoices = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, page = 1, limit = 20, search } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')

  const filter = { invoiceType: 'freight_carrier', ...dateFilter }
  if (status && status !== 'All') filter.status = status
  if (projectId) filter.leadId = projectId
  if (search) filter.$or = [{ invoiceNumber: { $regex: search, $options: 'i' } }]

  const [invoices, count] = await Promise.all([
    Invoice.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Invoice.countDocuments(filter),
  ])

  return success(res, { invoices, total: count, page: parseInt(page), limit: parseInt(limit) })
})

exports.getInvoiceManagementStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'date')

  const stats = await Invoice.aggregate([
    { $match: dateFilter },
    { $group: {
      _id: null,
      totalIncome:    { $sum: '$totalAmount' },
      productSales:   { $sum: { $cond: [{ $eq: ['$category', 'product'] }, '$totalAmount', 0] } },
      serviceRevenue: { $sum: { $cond: [{ $eq: ['$category', 'service'] }, '$totalAmount', 0] } },
      otherIncome:    { $sum: { $cond: [{ $eq: ['$category', 'other'] }, '$totalAmount', 0] } },
    }},
  ])

  const s = stats[0] || {}
  return success(res, {
    totalIncome:    s.totalIncome || 0,
    productSales:   s.productSales || 0,
    serviceRevenue: s.serviceRevenue || 0,
    otherIncome:    s.otherIncome || 0,
  })
})

exports.getProjectsDropdown = asyncHandler(async (req, res) => {
  const leads = await Lead.find({ isTerminated: { $ne: true } })
    .select('projectName jobId lifecycleStatus')
    .sort({ createdAt: -1 })
    .lean()

  const projects = leads.map(l => ({
    _id: l._id,
    label: `${l.projectName} (${l.jobId || 'No ID'})`,
    projectName: l.projectName,
    jobId: l.jobId,
  }))

  return success(res, { projects })
})
