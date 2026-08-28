const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const { buildDateFilter } = require('../../utils/dateRange')
const { generateVendorInvoicesExcel, generateFreightCarrierInvoicesExcel, generateSingleInvoiceExcel } = require('../../utils/exportInvoiceAdmin')

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

const buildVendorLikeInvoiceFilter = ({ invoiceType, status, projectId, startDate, endDate, search }) => {
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const filter = { invoiceType, ...dateFilter }
  if (status && status !== 'All') filter.status = status
  if (projectId) filter.leadId = projectId
  if (search) filter.$or = [{ invoiceNumber: { $regex: search, $options: 'i' } }]
  return filter
}

exports.getVendorInvoices = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, page = 1, limit = 20, search } = req.query
  const filter = buildVendorLikeInvoiceFilter({ invoiceType: 'vendor', status, projectId, startDate, endDate, search })

  const [invoices, count, stats] = await Promise.all([
    Invoice.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'vendorId', select: 'vendorName' })
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: filter },
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

// GET /vendor/export
exports.exportVendorInvoices = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, search } = req.query
  const filter = buildVendorLikeInvoiceFilter({ invoiceType: 'vendor', status, projectId, startDate, endDate, search })

  const invoices = await Invoice.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .populate({ path: 'vendorId', select: 'vendorName' })
    .sort({ date: -1 })
    .lean()

  const buffer = await generateVendorInvoicesExcel(invoices)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="vendor-invoices.xlsx"')
  return res.send(buffer)
})

exports.getFreightCarrierInvoices = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, page = 1, limit = 20, search } = req.query
  const filter = buildVendorLikeInvoiceFilter({ invoiceType: 'freight_carrier', status, projectId, startDate, endDate, search })

  const [invoices, count] = await Promise.all([
    Invoice.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId' })
      .populate({ path: 'carrierId', select: 'carrierName' })
      .sort({ date: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Invoice.countDocuments(filter),
  ])

  return success(res, { invoices, total: count, page: parseInt(page), limit: parseInt(limit) })
})

// GET /freight-carrier/export
exports.exportFreightCarrierInvoices = asyncHandler(async (req, res) => {
  const { status, projectId, startDate, endDate, search } = req.query
  const filter = buildVendorLikeInvoiceFilter({ invoiceType: 'freight_carrier', status, projectId, startDate, endDate, search })

  const invoices = await Invoice.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .populate({ path: 'carrierId', select: 'carrierName' })
    .sort({ date: -1 })
    .lean()

  const buffer = await generateFreightCarrierInvoicesExcel(invoices)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="freight-carrier-invoices.xlsx"')
  return res.send(buffer)
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

// ── Individual Invoice (Vendor + Freight Carrier detail screen) ────────────────

// GET /:invoiceId — "Individual Invoice" view
exports.getInvoiceDetail = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
    .populate('leadId', 'projectName jobId location buildingType')
    .populate('customerId', 'firstName lastName email phone')
    .populate('vendorId', 'vendorName email phone')
    .populate('carrierId', 'carrierName email phone')
    .populate('paidBy', 'name')
    .populate('createdBy', 'name')
    .lean()
  if (!invoice) return notFound(res, 'Invoice not found')

  return success(res, { invoice })
})

// GET /:invoiceId/export — "Export" on the Individual Invoice screen
exports.exportInvoiceDetail = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
    .populate('leadId', 'projectName jobId')
    .populate('vendorId', 'vendorName')
    .populate('carrierId', 'carrierName')
    .lean()
  if (!invoice) return notFound(res, 'Invoice not found')

  const buffer = await generateSingleInvoiceExcel(invoice)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber || invoice._id}.xlsx"`)
  return res.send(buffer)
})

// PUT /:invoiceId/mark-paid — "Mark Paid" on the Individual Invoice screen
exports.markInvoicePaid = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (invoice.status === 'paid') return badRequest(res, 'Invoice is already marked as paid')
  if (invoice.status === 'cancelled') return badRequest(res, 'Cannot mark a cancelled invoice as paid')

  invoice.status = 'paid'
  invoice.paidAt = new Date()
  invoice.paidBy = req.user._id
  if (req.body.paymentMethod) invoice.paymentMethod = req.body.paymentMethod
  await invoice.save()

  return success(res, { invoice }, 'Invoice marked as paid')
})
