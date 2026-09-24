const Invoice = require('../models/Invoice')
const Lead = require('../models/Lead')
const Vendor = require('../models/Vendor')
const FreightCarrier = require('../models/FreightCarrier')
const asyncHandler = require('../utils/asyncHandler')
const { success, created, notFound, badRequest, forbidden } = require('../utils/apiResponse')
const { buildDateFilter } = require('../utils/dateRange')
const {
  createPayableInvoice,
  buildPayableListRow,
  syncTopLevelStatusFromPayable,
} = require('../utils/payableInvoice.util')
const { INVOICE_TYPES, INVOICE_CATEGORIES, PAYABLE_WORKFLOW_STATUSES } = require('../config/constants')

const PAYABLE_TYPES = INVOICE_TYPES.filter((t) => t !== 'customer')

const assertPayableInvoice = (invoice) => {
  if (!invoice) return { error: 'Invoice not found', code: 404 }
  if (!PAYABLE_TYPES.includes(invoice.invoiceType)) {
    return { error: 'Not a vendor or freight carrier payable invoice', code: 400 }
  }
  return { invoice }
}

const buildPayableFilter = ({ invoiceType, payableStatus, status, projectId, startDate, endDate, search }) => {
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  const filter = { invoiceType, ...dateFilter }
  if (projectId) filter.leadId = projectId

  if (payableStatus) {
    filter['payableWorkflow.status'] = payableStatus
  } else if (status && status !== 'All') {
    filter.$or = [
      { 'payableWorkflow.status': status },
      { payableWorkflow: null, status },
    ]
  }

  if (search?.trim()) {
    filter.$and = filter.$and || []
    filter.$and.push({
      $or: [{ invoiceNumber: { $regex: search.trim(), $options: 'i' } }],
    })
  }

  return filter
}

const populatePayableQuery = (q) =>
  q
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .populate({ path: 'vendorId', select: 'vendorName' })
    .populate({ path: 'carrierId', select: 'carrierName' })
    .populate({ path: 'payableWorkflow.adminReviewedBy', select: 'name email' })
    .populate({ path: 'payableWorkflow.accountPaymentUpdatedBy', select: 'name email' })
    .populate({ path: 'payableWorkflow.comments.authorId', select: 'name email role' })

const loadPayableDetail = async (invoiceId) => {
  const invoice = await populatePayableQuery(Invoice.findById(invoiceId)).lean()
  return assertPayableInvoice(invoice)
}

const createManualPayable = async (req, res, invoiceType) => {
  const {
    leadId,
    vendorId,
    carrierId,
    totalAmount,
    category,
    description,
    date,
    daysToPay,
    documentUrl,
    documentFileName,
    payeeName,
  } = req.body

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Project not found')

  if (invoiceType === 'vendor') {
    if (!vendorId) return badRequest(res, 'vendorId is required')
    const vendor = await Vendor.findById(vendorId).lean()
    if (!vendor) return notFound(res, 'Vendor not found')
  } else {
    if (!carrierId) return badRequest(res, 'carrierId is required')
    const carrier = await FreightCarrier.findById(carrierId).lean()
    if (!carrier) return notFound(res, 'Freight carrier not found')
  }

  const invoice = await createPayableInvoice({
    invoiceType,
    leadId,
    vendorId,
    carrierId,
    payeeName,
    totalAmount,
    category,
    description,
    date,
    daysToPay,
    documentUrl,
    documentFileName,
    source: 'admin_manual',
    createdBy: req.user._id,
    initialPayableStatus: 'pending_admin_approval',
  })

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return created(res, { invoice: detail }, 'Payable invoice submitted for admin approval')
}

exports.createVendorPayable = asyncHandler((req, res) => createManualPayable(req, res, 'vendor'))
exports.createFreightCarrierPayable = asyncHandler((req, res) => createManualPayable(req, res, 'freight_carrier'))

exports.getPayableDetail = asyncHandler(async (req, res) => {
  const { invoice, error, code } = await loadPayableDetail(req.params.invoiceId)
  if (error) return code === 404 ? notFound(res, error) : badRequest(res, error)
  return success(res, { invoice, row: buildPayableListRow(invoice) })
})

exports.approvePayable = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  const check = assertPayableInvoice(invoice)
  if (check.error) return check.code === 404 ? notFound(res, check.error) : badRequest(res, check.error)

  if (!invoice.payableWorkflow) {
    return badRequest(res, 'Legacy invoice without payable workflow — use mark-paid or migrate')
  }
  if (invoice.payableWorkflow.status !== 'pending_admin_approval') {
    return badRequest(res, `Cannot approve when status is ${invoice.payableWorkflow.status}`)
  }

  invoice.payableWorkflow.status = 'approved_for_payment'
  invoice.payableWorkflow.adminReviewedBy = req.user._id
  invoice.payableWorkflow.adminReviewedAt = new Date()
  invoice.payableWorkflow.adminRejectionReason = ''
  syncTopLevelStatusFromPayable(invoice)
  await invoice.save()

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return success(res, { invoice: detail }, 'Approved for account payment')
})

exports.rejectPayable = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  const check = assertPayableInvoice(invoice)
  if (check.error) return check.code === 404 ? notFound(res, check.error) : badRequest(res, check.error)

  if (!invoice.payableWorkflow) return badRequest(res, 'Legacy invoice without payable workflow')
  if (invoice.payableWorkflow.status !== 'pending_admin_approval') {
    return badRequest(res, `Cannot reject when status is ${invoice.payableWorkflow.status}`)
  }

  const reason = String(req.body.reason || req.body.note || '').trim()
  invoice.payableWorkflow.status = 'rejected'
  invoice.payableWorkflow.adminReviewedBy = req.user._id
  invoice.payableWorkflow.adminReviewedAt = new Date()
  invoice.payableWorkflow.adminRejectionReason = reason
  syncTopLevelStatusFromPayable(invoice)
  await invoice.save()

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return success(res, { invoice: detail }, 'Payable invoice rejected')
})

exports.addAdminPayableComment = asyncHandler(async (req, res) => {
  const text = String(req.body.text || req.body.comment || '').trim()
  if (!text) return badRequest(res, 'text is required')

  const invoice = await Invoice.findById(req.params.invoiceId)
  const check = assertPayableInvoice(invoice)
  if (check.error) return check.code === 404 ? notFound(res, check.error) : badRequest(res, check.error)
  if (!invoice.payableWorkflow) return badRequest(res, 'Legacy invoice without payable workflow')

  invoice.payableWorkflow.comments.push({
    text,
    authorRole: 'admin',
    authorId: req.user._id,
    createdAt: new Date(),
  })
  await invoice.save()

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return success(res, { invoice: detail }, 'Comment added')
})

exports.listAccountPayables = asyncHandler(async (req, res) => {
  const { invoiceType, payableStatus, search, page = 1, limit = 20, startDate, endDate, projectId } = req.query
  const typeFilter = invoiceType && PAYABLE_TYPES.includes(invoiceType)
    ? invoiceType
    : { $in: PAYABLE_TYPES }

  const filter = {
    invoiceType: typeFilter,
    ...buildDateFilter({ startDate, endDate }, 'date'),
    'payableWorkflow.status': payableStatus || { $in: ['approved_for_payment', 'paid', 'unpaid'] },
  }
  if (projectId) filter.leadId = projectId
  if (search?.trim()) {
    filter.invoiceNumber = { $regex: search.trim(), $options: 'i' }
  }

  const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)))
  const lim = Math.min(100, Math.max(1, Number(limit)))

  const [rows, total, statsAgg] = await Promise.all([
    populatePayableQuery(Invoice.find(filter).sort({ date: -1 }).skip(skip).limit(lim)).lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: { invoiceType: { $in: PAYABLE_TYPES }, 'payableWorkflow.status': { $in: ['approved_for_payment', 'paid', 'unpaid'] } } },
      {
        $group: {
          _id: '$payableWorkflow.status',
          count: { $sum: 1 },
          amount: { $sum: '$totalAmount' },
        },
      },
    ]),
  ])

  const stats = { pendingPayment: 0, pendingAmount: 0, paid: 0, paidAmount: 0, unpaid: 0, unpaidAmount: 0 }
  for (const row of statsAgg) {
    if (row._id === 'approved_for_payment') {
      stats.pendingPayment = row.count
      stats.pendingAmount = row.amount
    } else if (row._id === 'paid') {
      stats.paid = row.count
      stats.paidAmount = row.amount
    } else if (row._id === 'unpaid') {
      stats.unpaid = row.count
      stats.unpaidAmount = row.amount
    }
  }

  return success(res, {
    stats,
    invoices: rows.map(buildPayableListRow),
    total,
    page: Number(page),
    limit: lim,
  })
})

exports.markPayablePaid = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  const check = assertPayableInvoice(invoice)
  if (check.error) return check.code === 404 ? notFound(res, check.error) : badRequest(res, check.error)
  if (!invoice.payableWorkflow) return badRequest(res, 'Legacy invoice without payable workflow')

  const allowed = ['approved_for_payment', 'unpaid']
  if (!allowed.includes(invoice.payableWorkflow.status)) {
    return badRequest(res, `Cannot mark paid from status ${invoice.payableWorkflow.status}`)
  }

  invoice.payableWorkflow.status = 'paid'
  invoice.payableWorkflow.accountPaymentUpdatedBy = req.user._id
  invoice.payableWorkflow.accountPaymentUpdatedAt = new Date()
  invoice.paidAt = new Date()
  invoice.paidBy = req.user._id
  if (req.body.paymentMethod) invoice.paymentMethod = req.body.paymentMethod
  syncTopLevelStatusFromPayable(invoice)
  await invoice.save()

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return success(res, { invoice: detail }, 'Marked as paid')
})

exports.markPayableUnpaid = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  const check = assertPayableInvoice(invoice)
  if (check.error) return check.code === 404 ? notFound(res, check.error) : badRequest(res, check.error)
  if (!invoice.payableWorkflow) return badRequest(res, 'Legacy invoice without payable workflow')

  if (invoice.payableWorkflow.status !== 'paid') {
    return badRequest(res, 'Only paid invoices can be marked unpaid')
  }

  invoice.payableWorkflow.status = 'unpaid'
  invoice.payableWorkflow.accountPaymentUpdatedBy = req.user._id
  invoice.payableWorkflow.accountPaymentUpdatedAt = new Date()
  invoice.paidAt = null
  invoice.paidBy = null
  invoice.paymentMethod = null
  syncTopLevelStatusFromPayable(invoice)
  await invoice.save()

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return success(res, { invoice: detail }, 'Marked as unpaid (reopened for payment)')
})

exports.addAccountPayableComment = asyncHandler(async (req, res) => {
  const text = String(req.body.text || req.body.comment || '').trim()
  if (!text) return badRequest(res, 'text is required')

  const invoice = await Invoice.findById(req.params.invoiceId)
  const check = assertPayableInvoice(invoice)
  if (check.error) return check.code === 404 ? notFound(res, check.error) : badRequest(res, check.error)
  if (!invoice.payableWorkflow) return badRequest(res, 'Legacy invoice without payable workflow')

  invoice.payableWorkflow.comments.push({
    text,
    authorRole: 'account',
    authorId: req.user._id,
    createdAt: new Date(),
  })
  await invoice.save()

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return success(res, { invoice: detail }, 'Comment added')
})

exports.listAdminPayablesQueue = asyncHandler(async (req, res) => {
  const { invoiceType = 'vendor', payableStatus, page = 1, limit = 20, projectId, startDate, endDate, search } = req.query
  if (!PAYABLE_TYPES.includes(invoiceType)) return badRequest(res, 'Invalid invoiceType')

  const filter = buildPayableFilter({
    invoiceType,
    payableStatus: payableStatus || 'pending_admin_approval',
    projectId,
    startDate,
    endDate,
    search,
  })

  const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Math.max(1, Number(limit)))
  const lim = Math.min(100, Math.max(1, Number(limit)))

  const [rows, total] = await Promise.all([
    populatePayableQuery(Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim)).lean(),
    Invoice.countDocuments(filter),
  ])

  return success(res, {
    invoices: rows.map(buildPayableListRow),
    total,
    page: Number(page),
    limit: lim,
  })
})

exports.payableFilterMeta = asyncHandler(async (req, res) => {
  return success(res, {
    payableStatuses: PAYABLE_WORKFLOW_STATUSES,
    invoiceTypes: PAYABLE_TYPES,
    categories: INVOICE_CATEGORIES,
  })
})

const emptyPlantPayableStats = () => ({
  totalIncome: 0,
  productSales: 0,
  serviceRevenue: 0,
  otherIncome: 0,
  pendingAdminApproval: 0,
  approvedForPayment: 0,
  paid: 0,
})

const resolvePlantPayableLeadFilter = async (req, projectId) => {
  const { getScopedLeadIds } = require('../utils/plantAccessScope')
  const scopedLeadIds = await getScopedLeadIds(req, {})
  if (!scopedLeadIds.length) return { leadIds: [], empty: true }

  if (projectId) {
    const allowed = scopedLeadIds.some((id) => String(id) === String(projectId))
    if (!allowed) return { leadIds: [], empty: true, denied: true }
    return { leadIds: [projectId], empty: false }
  }

  return { leadIds: scopedLeadIds, empty: false }
}

const buildPlantPayableListFilter = async (req, invoiceType) => {
  const { status, payableStatus, projectId, startDate, endDate, search } = req.query
  const scope = await resolvePlantPayableLeadFilter(req, projectId)
  if (scope.empty) {
    return { scope, filter: null }
  }

  const filter = buildPayableFilter({
    invoiceType,
    payableStatus,
    status,
    startDate,
    endDate,
    search,
  })
  filter.leadId = scope.leadIds.length === 1 ? scope.leadIds[0] : { $in: scope.leadIds }
  return { scope, filter }
}

const listPlantPayablesByType = async (req, res, invoiceType) => {
  if (!PAYABLE_TYPES.includes(invoiceType)) return badRequest(res, 'Invalid invoiceType')

  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20))
  const skip = (parsedPage - 1) * parsedLimit

  const { scope, filter } = await buildPlantPayableListFilter(req, invoiceType)
  if (scope.denied) return forbidden(res, 'Access denied for this project')
  if (scope.empty || !filter) {
    return success(res, {
      stats: emptyPlantPayableStats(),
      invoices: [],
      total: 0,
      page: parsedPage,
      limit: parsedLimit,
    })
  }

  const [invoices, count, categoryStats, statusStats] = await Promise.all([
    populatePayableQuery(Invoice.find(filter)).sort({ date: -1 }).skip(skip).limit(parsedLimit).lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalIncome: { $sum: '$totalAmount' },
          productSales: { $sum: { $cond: [{ $eq: ['$category', 'product'] }, '$totalAmount', 0] } },
          serviceRevenue: { $sum: { $cond: [{ $eq: ['$category', 'service'] }, '$totalAmount', 0] } },
          otherIncome: { $sum: { $cond: [{ $eq: ['$category', 'other'] }, '$totalAmount', 0] } },
        },
      },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, payableWorkflow: { $ne: null } } },
      { $group: { _id: '$payableWorkflow.status', count: { $sum: 1 } } },
    ]),
  ])

  const s = categoryStats[0] || {}
  const stats = {
    totalIncome: s.totalIncome || 0,
    productSales: s.productSales || 0,
    serviceRevenue: s.serviceRevenue || 0,
    otherIncome: s.otherIncome || 0,
    pendingAdminApproval: 0,
    approvedForPayment: 0,
    paid: 0,
  }
  for (const row of statusStats) {
    if (row._id === 'pending_admin_approval') stats.pendingAdminApproval = row.count
    if (row._id === 'approved_for_payment' || row._id === 'unpaid') {
      stats.approvedForPayment += row.count
    }
    if (row._id === 'paid') stats.paid = row.count
  }

  return success(res, {
    stats,
    invoices: invoices.map(buildPayableListRow),
    total: count,
    page: parsedPage,
    limit: parsedLimit,
  })
}

exports.listPlantVendorPayables = asyncHandler((req, res) => listPlantPayablesByType(req, res, 'vendor'))
exports.listPlantFreightCarrierPayables = asyncHandler((req, res) =>
  listPlantPayablesByType(req, res, 'freight_carrier')
)

exports.getPlantPayableDetail = asyncHandler(async (req, res) => {
  const { invoice, error, code } = await loadPayableDetail(req.params.invoiceId)
  if (error) return code === 404 ? notFound(res, error) : badRequest(res, error)

  const leadId = invoice.leadId?._id || invoice.leadId
  const { assertPlantProjectAccess } = require('../utils/plantProjectAccess')
  const access = await assertPlantProjectAccess(leadId, req)
  if (access.error) {
    return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }

  return success(res, { invoice, row: buildPayableListRow(invoice) })
})
