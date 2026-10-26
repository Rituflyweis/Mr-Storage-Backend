const ExcelJS = require('exceljs')
const Invoice = require('../models/Invoice')
const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const Quotation = require('../models/Quotation')
const { buildDateFilter } = require('../utils/dateRange')
const { buildPayableListRow, createPayableInvoice, populatePayableQuery } = require('../utils/payableInvoice.util')
const { aggregateProjectExpensesForLead } = require('../utils/projectExpenseAggregate.util')
const { marginPct } = require('../utils/profitLossPeriod.util')
const { resolveCustomerInvoiceDocuments } = require('../utils/customerInvoiceDocument.util')
const { pickBillingFieldsForListRow } = require('../utils/invoiceBilling.util')
const { distinctFinancialLeadIds } = require('../utils/financialProjectScope')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const LOW_MARGIN_PCT = 15

const paginate = (query) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

const payableVerificationLabel = (payableStatus) => {
  if (payableStatus === 'pending_admin_approval' || payableStatus === 'rejected') return 'Pending'
  if (['approved_for_payment', 'paid', 'unpaid'].includes(payableStatus)) return 'Verified'
  return 'Pending'
}

const payablePaymentLabel = (payableStatus) => {
  if (payableStatus === 'paid') return 'Completed'
  if (['approved_for_payment', 'unpaid', 'pending_admin_approval'].includes(payableStatus)) return 'Pending'
  if (payableStatus === 'rejected') return 'Rejected'
  return 'Pending'
}

const miscApprovalLabel = (payableStatus) => {
  if (payableStatus === 'rejected') return 'Rejected'
  if (payableStatus === 'pending_admin_approval') return 'Pending'
  return 'Approved'
}

const miscPaymentLabel = (payableStatus) => {
  if (payableStatus === 'paid') return 'Paid'
  return 'Pending'
}

const mapPayableStatusFilter = (status, field = 'verification') => {
  if (!status || status === 'All') return null
  const s = String(status).toLowerCase()
  if (field === 'verification') {
    if (s === 'verified') return { 'payableWorkflow.status': { $in: ['approved_for_payment', 'paid', 'unpaid'] } }
    if (s === 'pending') return { 'payableWorkflow.status': { $in: ['pending_admin_approval', 'rejected'] } }
  }
  if (field === 'payment') {
    if (s === 'completed' || s === 'paid') return { 'payableWorkflow.status': 'paid' }
    if (s === 'pending') return { 'payableWorkflow.status': { $ne: 'paid' } }
  }
  if (field === 'approval') {
    if (s === 'approved') return { 'payableWorkflow.status': { $in: ['approved_for_payment', 'paid', 'unpaid'] } }
    if (s === 'pending') return { 'payableWorkflow.status': 'pending_admin_approval' }
  }
  return null
}

const buildPayableTabFilter = ({ invoiceType, query, miscOnly = false }) => {
  const dateFilter = buildDateFilter(query, 'date')
  const filter = { invoiceType, ...dateFilter, payableWorkflow: { $ne: null } }
  if (miscOnly) filter['payableWorkflow.source'] = 'account_misc'
  else if (invoiceType === 'vendor') filter['payableWorkflow.source'] = { $ne: 'account_misc' }

  if (query.projectId || query.leadId) filter.leadId = query.projectId || query.leadId

  const verification = mapPayableStatusFilter(query.verificationStatus || query.status, 'verification')
  const payment = mapPayableStatusFilter(query.paymentStatus, 'payment')
  if (verification) Object.assign(filter, verification)
  if (payment) Object.assign(filter, payment)

  if (query.search?.trim()) {
    const regex = { $regex: query.search.trim(), $options: 'i' }
    filter.$or = [
      { invoiceNumber: regex },
      { payeeName: regex },
      { serviceCategory: regex },
    ]
  }
  return filter
}

const sortPayableQuery = (query, q) => {
  const sortBy = query.sortBy || 'dueDate'
  const order = query.sortOrder === 'asc' ? 1 : -1
  if (sortBy === 'amount') return q.sort({ totalAmount: order, date: -1 })
  if (sortBy === 'date' || sortBy === 'invoiceDate') return q.sort({ date: order })
  return q.sort({ dueDate: order, date: -1 })
}

const formatVendorCarrierRow = (inv) => {
  const row = buildPayableListRow(inv)
  return {
    invoiceId: inv._id,
    invoiceNumber: row.invoiceNumber,
    vendorName: row.vendorName,
    carrierName: row.carrierName,
    name: inv.invoiceType === 'freight_carrier' ? row.carrierName : row.vendorName,
    project: row.projectName,
    projectName: row.projectName,
    leadId: row.leadId,
    amount: round2(row.amount),
    dueDate: row.dueDate,
    verification: payableVerificationLabel(row.payableStatus),
    verificationStatus: row.payableStatus,
    payment: payablePaymentLabel(row.payableStatus),
    paymentStatus: row.payableStatus,
    payableStatus: row.payableStatus,
    documentUrl: row.documentUrl,
  }
}

const formatMiscRow = (inv) => {
  const row = buildPayableListRow(inv)
  return {
    invoiceId: inv._id,
    invoiceNumber: row.invoiceNumber,
    serviceProvider: row.serviceProvider,
    category: row.serviceCategory || row.category || 'Other',
    amount: round2(row.amount),
    invoiceDate: row.date,
    dueDate: row.dueDate,
    approval: miscApprovalLabel(row.payableStatus),
    payment: miscPaymentLabel(row.payableStatus),
    payableStatus: row.payableStatus,
    projectName: row.projectName,
    leadId: row.leadId,
    documentUrl: row.documentUrl,
  }
}

const aggregatePayableStats = async (filter) => {
  const base = { ...filter }
  delete base.$or

  const [totals, pendingVerification, pendingPayment] = await Promise.all([
    Invoice.aggregate([
      { $match: base },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
    Invoice.countDocuments({
      ...base,
      'payableWorkflow.status': { $in: ['pending_admin_approval', 'rejected'] },
    }),
    Invoice.aggregate([
      {
        $match: {
          ...base,
          'payableWorkflow.status': { $in: ['approved_for_payment', 'unpaid'] },
        },
      },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
  ])

  const t = totals[0] || {}
  const pp = pendingPayment[0] || {}
  return {
    totalInvoices: t.count || 0,
    invoiceAmount: round2(t.amount || 0),
    pendingVerification: pendingVerification || 0,
    pendingPaymentCount: pp.count || 0,
    pendingPaymentAmount: round2(pp.amount || 0),
  }
}

exports.getFilters = async () => {
  const projects = await Lead.find({ isTerminated: { $ne: true } })
    .select('projectName jobId')
    .sort({ projectName: 1 })
    .limit(500)
    .lean()

  return {
    projects: projects.map((p) => ({
      leadId: p._id,
      projectId: p._id,
      projectName: p.projectName,
      jobId: p.jobId,
    })),
    verificationStatuses: ['Verified', 'Pending'],
    paymentStatuses: ['Completed', 'Pending'],
    miscCategories: ['Maintenance', 'Software', 'Security', 'Professional', 'Utilities', 'Other'],
    quotationProfitStatuses: ['Profitable', 'Low Margin', 'Loss'],
  }
}

exports.getProjectSummary = async (query = {}) => {
  const dateFilter = buildDateFilter(query, 'date')
  const filter = { invoiceType: 'customer', ...dateFilter }
  if (query.projectId || query.leadId) filter.leadId = query.projectId || query.leadId

  const [totals, received, outstanding, overdue] = await Promise.all([
    Invoice.aggregate([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, status: 'paid' } },
      { $group: { _id: null, amount: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, status: { $in: ['sent', 'draft', 'overdue'] } } },
      { $group: { _id: null, amount: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...filter, status: 'overdue' } },
      { $group: { _id: null, amount: { $sum: '$totalAmount' } } },
    ]),
  ])

  const t = totals[0] || {}
  return {
    totalInvoices: t.count || 0,
    invoiceAmount: round2(t.amount || 0),
    totalBilled: round2(t.amount || 0),
    totalReceived: round2(received[0]?.amount || 0),
    outstandingAmount: round2(outstanding[0]?.amount || 0),
    overdueAmount: round2(overdue[0]?.amount || 0),
  }
}

exports.listProjectRecords = async (query = {}) => {
  const { page, limit, skip } = paginate(query)
  const dateFilter = buildDateFilter(query, 'date')
  const filter = { invoiceType: 'customer', ...dateFilter }
  if (query.projectId || query.leadId) filter.leadId = query.projectId || query.leadId
  if (query.paymentStatus) {
    const ps = String(query.paymentStatus).toLowerCase()
    if (ps === 'paid') filter.status = 'paid'
    else if (ps === 'pending' || ps === 'unpaid') filter.status = { $in: ['sent', 'draft', 'overdue'] }
  }
  if (query.search?.trim()) {
    filter.invoiceNumber = { $regex: query.search.trim(), $options: 'i' }
  }

  const sortBy = query.sortBy || 'dueDate'
  const order = query.sortOrder === 'asc' ? 1 : -1
  const sort =
    sortBy === 'amount' ? { totalAmount: order } : sortBy === 'date' ? { date: order } : { dueDate: order }

  const [rows, total] = await Promise.all([
    Invoice.find(filter)
      .populate('customerId', 'firstName lastName companyName')
      .populate('leadId', 'projectName jobId')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(filter),
  ])

  const records = rows.map((inv) => {
    const cust = inv.customerId
    const customerName = cust
      ? [cust.firstName, cust.lastName].filter(Boolean).join(' ') || cust.companyName || '—'
      : '—'
    const paid = inv.status === 'paid' ? inv.totalAmount : 0
    const docs = resolveCustomerInvoiceDocuments(inv)
    return {
      invoiceId: inv._id,
      invoiceNumber: inv.invoiceNumber,
      customerName,
      customerId: inv.customerId?._id || inv.customerId,
      project: inv.leadId?.projectName || '—',
      projectName: inv.leadId?.projectName || '—',
      leadId: inv.leadId?._id || inv.leadId,
      invoiceType: inv.category || 'product',
      invoiceTypeLabel: inv.category ? inv.category.charAt(0).toUpperCase() + inv.category.slice(1) : 'Product',
      amount: round2(inv.totalAmount),
      dueDate: inv.dueDate,
      invoiceDate: inv.date,
      paymentStatus: inv.status === 'paid' ? 'Paid' : 'Pending',
      invoiceStatus: inv.status,
      paid: round2(paid),
      amountDue: round2(inv.status === 'paid' ? 0 : inv.totalAmount),
      documentUrl: docs.documentUrl,
      pdfUrl: docs.pdfUrl,
      documentType: docs.documentType,
      ...pickBillingFieldsForListRow(inv),
    }
  })

  return { records, total, page, limit }
}

exports.getVendorSummary = async (query) => aggregatePayableStats(buildPayableTabFilter({ invoiceType: 'vendor', query }))
exports.getCarrierSummary = async (query) =>
  aggregatePayableStats(buildPayableTabFilter({ invoiceType: 'freight_carrier', query }))

const listPayableRecords = async (invoiceType, query, miscOnly) => {
  const { page, limit, skip } = paginate(query)
  const filter = buildPayableTabFilter({ invoiceType, query, miscOnly })

  const [rows, total] = await Promise.all([
    sortPayableQuery(
      query,
      populatePayableQuery(Invoice.find(filter).skip(skip).limit(limit))
    ).lean(),
    Invoice.countDocuments(filter),
  ])

  const records = miscOnly ? rows.map(formatMiscRow) : rows.map(formatVendorCarrierRow)
  return { records, total, page, limit }
}

exports.listVendorRecords = async (query) => listPayableRecords('vendor', query, false)
exports.listCarrierRecords = async (query) => listPayableRecords('freight_carrier', query, false)

exports.getMiscellaneousSummary = async (query) => {
  const filter = buildPayableTabFilter({ invoiceType: 'vendor', query, miscOnly: true })
  const base = { ...filter }
  delete base.$or

  const [totals, pendingPayment, overdue] = await Promise.all([
    Invoice.aggregate([
      { $match: base },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      { $match: { ...base, 'payableWorkflow.status': { $ne: 'paid' } } },
      { $group: { _id: null, amount: { $sum: '$totalAmount' } } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          ...base,
          dueDate: { $lt: new Date() },
          'payableWorkflow.status': { $ne: 'paid' },
        },
      },
      { $group: { _id: null, amount: { $sum: '$totalAmount' } } },
    ]),
  ])

  const t = totals[0] || {}
  return {
    totalInvoices: t.count || 0,
    totalInvoiceAmount: round2(t.amount || 0),
    pendingPaymentAmount: round2(pendingPayment[0]?.amount || 0),
    overdueAmount: round2(overdue[0]?.amount || 0),
  }
}

exports.listMiscellaneousRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = buildPayableTabFilter({ invoiceType: 'vendor', query, miscOnly: true })
  const approval = mapPayableStatusFilter(query.approvalStatus || query.status, 'approval')
  const payment = mapPayableStatusFilter(query.paymentStatus, 'payment')
  if (approval) Object.assign(filter, approval)
  if (payment) Object.assign(filter, payment)

  const [rows, total] = await Promise.all([
    sortPayableQuery(
      query,
      populatePayableQuery(Invoice.find(filter).skip(skip).limit(limit))
    ).lean(),
    Invoice.countDocuments(filter),
  ])

  return { records: rows.map(formatMiscRow), total, page, limit }
}

const mapPaymentStatusToPayable = (paymentStatus) => {
  const s = String(paymentStatus || 'unpaid').toLowerCase()
  if (s === 'paid' || s === 'completed') return 'paid'
  return 'pending_admin_approval'
}

exports.createMiscellaneousInvoice = async (body, userId) => {
  const {
    invoiceNumber,
    serviceProvider,
    payeeName,
    amount,
    totalAmount,
    dueDate,
    paymentStatus,
    category,
    serviceCategory,
    documentUrl,
    documentFileName,
    leadId,
    projectId,
    description,
  } = body

  const resolvedLeadId = leadId || projectId
  if (!resolvedLeadId) return { error: 'projectId (leadId) is required' }
  const lead = await Lead.findById(resolvedLeadId).select('_id').lean()
  if (!lead) return { error: 'Project not found', code: 404 }

  const amt = Number(totalAmount ?? amount)
  if (!Number.isFinite(amt) || amt <= 0) return { error: 'amount must be a positive number' }

  const provider = String(serviceProvider || payeeName || '').trim()
  if (!provider) return { error: 'serviceProvider is required' }

  if (invoiceNumber?.trim()) {
    const exists = await Invoice.findOne({ invoiceNumber: invoiceNumber.trim() }).select('_id').lean()
    if (exists) return { error: 'invoiceNumber already exists' }
  }

  const invoice = await createPayableInvoice({
    invoiceType: 'vendor',
    leadId: resolvedLeadId,
    payeeName: provider,
    totalAmount: amt,
    category: category || 'service',
    serviceCategory: serviceCategory || category || 'Other',
    description: description || '',
    date: body.invoiceDate || body.date || new Date(),
    daysToPay: dueDate ? Math.max(1, Math.ceil((new Date(dueDate) - new Date()) / 86400000)) : 30,
    documentUrl,
    documentFileName,
    source: 'account_misc',
    createdBy: userId,
    initialPayableStatus: mapPaymentStatusToPayable(paymentStatus),
    invoiceNumber: invoiceNumber?.trim(),
    billingAddress: body.billingAddress,
    recipientAddress: body.recipientAddress,
    bankDetails: body.bankDetails,
  })

  if (dueDate) {
    invoice.dueDate = new Date(dueDate)
    await invoice.save()
  }

  const detail = await populatePayableQuery(Invoice.findById(invoice._id)).lean()
  return { record: formatMiscRow(detail) }
}

const resolveQuotationProfitStatus = (profit, margin) => {
  if (profit < 0) return 'Loss'
  if (margin < LOW_MARGIN_PCT) return 'Low Margin'
  return 'Profitable'
}

const formatQuotationId = (q) => {
  if (q.quoteNumber?.trim()) return q.quoteNumber.trim()
  const tail = String(q._id).slice(-5).toUpperCase()
  return `QT-${tail}`
}

const buildQuotationRow = async (q, dateFilterOnExpenses = {}) => {
  const pa = q.profitAnalysis || {}
  const revenue = pa.revenueOverride != null ? Number(pa.revenueOverride) : Number(q.finalPrice || q.basePrice || 0)
  let actualCost = pa.actualCostOverride != null ? Number(pa.actualCostOverride) : null
  if (actualCost == null) {
    const agg = await aggregateProjectExpensesForLead(q.leadId?._id || q.leadId, dateFilterOnExpenses)
    actualCost = agg.totalExpense
  }
  const profit = round2(revenue - actualCost)
  const margin = marginPct(profit, revenue)
  const status =
    pa.statusOverride && pa.statusOverride !== ''
      ? pa.statusOverride
      : resolveQuotationProfitStatus(profit, margin)

  const cust = q.customerId
  const customerName = cust
    ? [cust.firstName, cust.lastName].filter(Boolean).join(' ') || cust.companyName || '—'
    : '—'

  return {
    quotationId: q._id,
    quotationNumber: formatQuotationId(q),
    customerName,
    customerId: q.customerId?._id || q.customerId,
    project: q.leadId?.projectName || '—',
    projectName: q.leadId?.projectName || '—',
    leadId: q.leadId?._id || q.leadId,
    revenue: round2(revenue),
    actualCost: round2(actualCost),
    profitLoss: profit,
    profitLossLabel: profit >= 0 ? `+$${Math.abs(profit).toLocaleString('en-US')}` : `-$${Math.abs(profit).toLocaleString('en-US')}`,
    marginPct: margin,
    status,
    statusCode: status === 'Profitable' ? 'P' : status === 'Low Margin' ? 'L' : 'L',
    documentUrl: pa.documentUrl || '',
    proposalDate: q.proposalDate,
  }
}

exports.getQuotationProfitSummary = async (query = {}) => {
  const dateFilter = buildDateFilter(query, 'proposalDate')
  const financialLeadIds = await distinctFinancialLeadIds()
  const match = { ...dateFilter, leadId: { $in: financialLeadIds } }

  const quotations = await Quotation.find(match).select('leadId finalPrice basePrice profitAnalysis').lean()
  let quotedRevenue = 0
  let actualCostSum = 0
  let actualRevenue = 0
  let actualProfit = 0

  for (const q of quotations) {
    const pa = q.profitAnalysis || {}
    const revenue = pa.revenueOverride != null ? Number(pa.revenueOverride) : Number(q.finalPrice || q.basePrice || 0)
    quotedRevenue += revenue
    actualRevenue += revenue
    let cost = pa.actualCostOverride != null ? Number(pa.actualCostOverride) : null
    if (cost == null) {
      const agg = await aggregateProjectExpensesForLead(q.leadId, {})
      cost = agg.totalExpense
    }
    actualCostSum += cost
    actualProfit += revenue - cost
  }

  return {
    totalQuotations: quotations.length,
    quotedRevenue: round2(quotedRevenue),
    actualRevenue: round2(actualRevenue),
    actualCost: round2(actualCostSum),
    actualProfit: round2(actualProfit),
  }
}

exports.listQuotationProfitRecords = async (query = {}) => {
  const { page, limit, skip } = paginate(query)
  const dateFilter = buildDateFilter(query, 'proposalDate')
  const financialLeadIds = await distinctFinancialLeadIds()
  const filter = { ...dateFilter, leadId: { $in: financialLeadIds } }

  if (query.projectId || query.leadId) filter.leadId = query.projectId || query.leadId
  if (query.search?.trim()) {
    const regex = new RegExp(query.search.trim(), 'i')
    const customerIds = await Customer.find({
      $or: [{ firstName: regex }, { lastName: regex }, { companyName: regex }],
    }).distinct('_id')
    filter.$or = [{ quoteNumber: regex }, { customerId: { $in: customerIds } }]
  }

  const sortBy = query.sortBy || 'proposalDate'
  const order = query.sortOrder === 'asc' ? 1 : -1
  const sort =
    sortBy === 'revenue'
      ? { finalPrice: order }
      : sortBy === 'margin' || sortBy === 'profitLoss'
        ? { finalPrice: order }
        : { proposalDate: order }

  let [quotations, total] = await Promise.all([
    Quotation.find(filter)
      .populate('customerId', 'firstName lastName companyName')
      .populate('leadId', 'projectName jobId')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Quotation.countDocuments(filter),
  ])

  const expenseDateFilter = buildDateFilter(query, 'date')
  let records = await Promise.all(quotations.map((q) => buildQuotationRow(q, expenseDateFilter)))

  if (query.status && query.status !== 'All') {
    const want = String(query.status)
    records = records.filter((r) => r.status === want)
    total = records.length
  }

  if (['profitLoss', 'margin', 'actualCost', 'revenue'].includes(sortBy)) {
    const dir = query.sortOrder === 'asc' ? 1 : -1
    records.sort((a, b) => {
      const key =
        sortBy === 'profitLoss'
          ? 'profitLoss'
          : sortBy === 'margin'
            ? 'marginPct'
            : sortBy === 'actualCost'
              ? 'actualCost'
              : 'revenue'
      return (a[key] - b[key]) * dir
    })
  }

  return { records, total, page, limit }
}

exports.uploadQuotationProfit = async (body, userId) => {
  const { quotationId, leadId, documentUrl, documentFileName, revenue, actualCost, status } = body
  if (!quotationId && !leadId) return { error: 'quotationId or leadId is required' }

  let quotation
  if (quotationId) {
    quotation = await Quotation.findById(quotationId)
  } else {
    quotation = await Quotation.findOne({ leadId }).sort({ createdAt: -1 })
  }
  if (!quotation) return { error: 'Quotation not found', code: 404 }

  quotation.profitAnalysis = quotation.profitAnalysis || {}
  if (documentUrl) quotation.profitAnalysis.documentUrl = documentUrl
  if (documentFileName) quotation.profitAnalysis.documentFileName = documentFileName
  if (revenue != null) quotation.profitAnalysis.revenueOverride = Number(revenue)
  if (actualCost != null) quotation.profitAnalysis.actualCostOverride = Number(actualCost)
  if (status) quotation.profitAnalysis.statusOverride = status
  quotation.profitAnalysis.uploadedBy = userId
  quotation.profitAnalysis.uploadedAt = new Date()
  await quotation.save()

  const populated = await Quotation.findById(quotation._id)
    .populate('customerId', 'firstName lastName companyName')
    .populate('leadId', 'projectName jobId')
    .lean()

  return { record: await buildQuotationRow(populated, {}) }
}

exports.getQuotationProfitDetail = async (quotationId, query = {}) => {
  const q = await Quotation.findById(quotationId)
    .populate('customerId', 'firstName lastName companyName email phone')
    .populate('leadId', 'projectName jobId location')
    .lean()
  if (!q) return { error: 'Quotation not found', code: 404 }
  const expenseDateFilter = buildDateFilter(query, 'date')
  return { record: await buildQuotationRow(q, expenseDateFilter), quotation: q }
}

const exportRowsToExcel = async (sheetName, columns, rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.addRow(columns.map((c) => c.header))
  for (const row of rows) {
    sheet.addRow(columns.map((c) => row[c.key] ?? ''))
  }
  return workbook.xlsx.writeBuffer()
}

exports.exportVendorRecords = async (query) => {
  const filter = buildPayableTabFilter({ invoiceType: 'vendor', query, miscOnly: false })
  const rows = await populatePayableQuery(Invoice.find(filter).sort({ dueDate: -1 }).limit(5000)).lean()
  const buffer = await exportRowsToExcel(
    'Vendor Invoices',
    [
      { header: 'Invoice Number', key: 'invoiceNumber' },
      { header: 'Vendor', key: 'vendorName' },
      { header: 'Project', key: 'project' },
      { header: 'Amount', key: 'amount' },
      { header: 'Due Date', key: 'dueDate' },
      { header: 'Verification', key: 'verification' },
      { header: 'Payment', key: 'payment' },
    ],
    rows.map(formatVendorCarrierRow)
  )
  return { buffer, filename: 'vendor-invoices.xlsx' }
}

exports.exportCarrierRecords = async (query) => {
  const filter = buildPayableTabFilter({ invoiceType: 'freight_carrier', query })
  const rows = await populatePayableQuery(Invoice.find(filter).sort({ dueDate: -1 }).limit(5000)).lean()
  const buffer = await exportRowsToExcel(
    'Carrier Invoices',
    [
      { header: 'Invoice Number', key: 'invoiceNumber' },
      { header: 'Carrier', key: 'name' },
      { header: 'Project', key: 'project' },
      { header: 'Amount', key: 'amount' },
      { header: 'Due Date', key: 'dueDate' },
      { header: 'Verification', key: 'verification' },
      { header: 'Payment', key: 'payment' },
    ],
    rows.map(formatVendorCarrierRow)
  )
  return { buffer, filename: 'carrier-invoices.xlsx' }
}

exports.exportMiscellaneousRecords = async (query) => {
  const filter = buildPayableTabFilter({ invoiceType: 'vendor', query, miscOnly: true })
  const rows = await populatePayableQuery(Invoice.find(filter).sort({ date: -1 }).limit(5000)).lean()
  const buffer = await exportRowsToExcel(
    'Miscellaneous Invoices',
    [
      { header: 'Invoice ID', key: 'invoiceNumber' },
      { header: 'Service Provider', key: 'serviceProvider' },
      { header: 'Category', key: 'category' },
      { header: 'Amount', key: 'amount' },
      { header: 'Invoice Date', key: 'invoiceDate' },
      { header: 'Approval', key: 'approval' },
      { header: 'Payment', key: 'payment' },
    ],
    rows.map(formatMiscRow)
  )
  return { buffer, filename: 'miscellaneous-invoices.xlsx' }
}

exports.exportQuotationProfitRecords = async (query) => {
  const { records } = await exports.listQuotationProfitRecords({ ...query, page: 1, limit: 5000 })
  const buffer = await exportRowsToExcel(
    'Quotation Profit Loss',
    [
      { header: 'Quotation ID', key: 'quotationNumber' },
      { header: 'Customer', key: 'customerName' },
      { header: 'Project', key: 'projectName' },
      { header: 'Revenue', key: 'revenue' },
      { header: 'Actual Cost', key: 'actualCost' },
      { header: 'Profit/Loss', key: 'profitLoss' },
      { header: 'Margin %', key: 'marginPct' },
      { header: 'Status', key: 'status' },
    ],
    records
  )
  return { buffer, filename: 'quotation-profit-loss.xlsx' }
}

exports.exportProjectRecords = async (query) => {
  const { records } = await exports.listProjectRecords({ ...query, page: 1, limit: 5000 })
  const buffer = await exportRowsToExcel(
    'Project Invoices',
    [
      { header: 'Invoice Number', key: 'invoiceNumber' },
      { header: 'Customer', key: 'customerName' },
      { header: 'Project', key: 'projectName' },
      { header: 'Type', key: 'invoiceTypeLabel' },
      { header: 'Amount', key: 'amount' },
      { header: 'Due Date', key: 'dueDate' },
      { header: 'Payment', key: 'paymentStatus' },
    ],
    records
  )
  return { buffer, filename: 'project-invoices.xlsx' }
}
