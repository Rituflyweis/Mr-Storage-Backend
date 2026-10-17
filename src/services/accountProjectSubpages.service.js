const Invoice = require('../models/Invoice')
const Quotation = require('../models/Quotation')
const Delivery = require('../models/Delivery')
const PaymentApproval = require('../models/PaymentApproval')
const ConsolidatedBOM = require('../models/ConsolidatedBOM')
const User = require('../models/User')
const { resolveProject } = require('./accountProject.service')
const invoiceMgmt = require('./accountInvoiceManagement.service')
const { formatAccountConsolidatedBom } = require('../utils/consolidatedBomAccount.util')
const { resolveCustomerInvoiceDocuments } = require('../utils/customerInvoiceDocument.util')
const {
  formatAccountDeliveryDetail,
  SELECTED_DELIVERY_STATUSES,
} = require('../utils/accountDeliveryDetail.util')
const {
  findLatestContractDocument,
  buildAgreementPayload,
} = require('../utils/leadAgreement')
const { isInvoiceOverdue } = require('../utils/invoiceScope')
const { buildPayableListRow } = require('../utils/payableInvoice.util')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const paginate = (query) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

const resolveLeadOrError = async (projectId) => {
  const lead = await resolveProject(projectId)
  if (!lead || lead.isDeleted) return { error: 'Project not found', code: 404 }
  return { lead }
}

const mapInvoiceStatusLabel = (inv, now = new Date()) => {
  if (inv.status === 'paid') return 'Paid'
  if (isInvoiceOverdue(inv, now)) return 'Overdue'
  return 'Pending'
}

exports.getProjectInvoicesSummary = async (projectId, query = {}) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }
  return invoiceMgmt.getProjectSummary({ ...query, leadId: lead._id })
}

exports.listProjectInvoices = async (projectId, query = {}) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const data = await invoiceMgmt.listProjectRecords({ ...query, leadId: lead._id })
  const ids = data.records.map((r) => r.invoiceId)
  const lineCounts = ids.length
    ? Object.fromEntries(
        (
          await Invoice.find({ _id: { $in: ids } })
            .select('_id lineItems')
            .lean()
        ).map((inv) => [String(inv._id), inv.lineItems?.length || 0])
      )
    : {}

  const now = new Date()
  const records = data.records.map((row) => ({
    ...row,
    status: mapInvoiceStatusLabel(
      { status: row.invoiceStatus, dueDate: row.dueDate, date: row.invoiceDate },
      now
    ),
    sentDate: row.invoiceDate,
    items: lineCounts[String(row.invoiceId)] || 0,
  }))

  return { ...data, records, leadId: lead._id, projectName: lead.projectName }
}

exports.getProjectPaymentsSummary = async (projectId) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const leadId = lead._id
  const [customerInvoices, payables, approvals] = await Promise.all([
    Invoice.find({
      leadId,
      invoiceType: { $nin: ['vendor', 'freight_carrier'] },
      status: { $ne: 'cancelled' },
    }).lean(),
    Invoice.find({
      leadId,
      invoiceType: { $in: ['vendor', 'freight_carrier'] },
      'payableWorkflow.status': 'paid',
    }).lean(),
    PaymentApproval.find({ leadId, status: 'approved' }).lean(),
  ])

  let totalReceived = 0
  let pendingAmount = 0
  let overdueAmount = 0
  const now = new Date()

  for (const inv of customerInvoices) {
    const amt = inv.totalAmount || 0
    if (inv.status === 'paid') totalReceived += amt
    else if (isInvoiceOverdue(inv, now)) overdueAmount += amt
    else pendingAmount += amt
  }

  for (const inv of payables) totalReceived += inv.totalAmount || 0
  for (const row of approvals) totalReceived += row.amount || 0

  const totalInvoiced = customerInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0)
  const paymentCompletionPct =
    totalInvoiced > 0 ? round2((totalReceived / totalInvoiced) * 100) : 0

  return {
    totalPaymentsReceived: round2(totalReceived),
    paymentCompletionPct,
    pendingAmount: round2(pendingAmount),
    overdueAmount: round2(overdueAmount),
    totalInvoiced: round2(totalInvoiced),
  }
}

exports.listProjectPayments = async (projectId, query = {}) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const { page, limit, skip } = paginate(query)
  const leadId = lead._id

  const [approvals, paidPayables, paidCustomer] = await Promise.all([
    PaymentApproval.find({ leadId, status: 'approved' }).sort({ paidAt: -1, updatedAt: -1 }).lean(),
    Invoice.find({ leadId, 'payableWorkflow.status': 'paid' })
      .populate('vendorId', 'vendorName')
      .populate('carrierId', 'carrierName')
      .sort({ paidAt: -1 })
      .lean(),
    Invoice.find({
      leadId,
      invoiceType: { $nin: ['vendor', 'freight_carrier'] },
      status: 'paid',
    })
      .sort({ paidAt: -1 })
      .lean(),
  ])

  const rows = []

  for (const a of approvals) {
    rows.push({
      paymentId: a._id,
      date: a.paidAt || a.reviewedAt || a.updatedAt,
      amount: round2(a.amount),
      relatedTo: a.payeeType === 'carrier' ? 'Carrier' : a.payeeType === 'vendor' ? 'Vendor' : a.payee || 'Vendor',
      status: 'Received',
      invoiceNumber: a.invoiceNumber || a.paymentId,
      invoiceId: null,
      source: 'payment_approval',
    })
  }

  for (const inv of paidPayables) {
    const row = buildPayableListRow(inv)
    rows.push({
      paymentId: inv._id,
      date: inv.paidAt || inv.updatedAt,
      amount: round2(row.amount),
      relatedTo: inv.invoiceType === 'freight_carrier' ? 'Carrier' : 'Vendor',
      status: 'Received',
      invoiceNumber: row.invoiceNumber,
      invoiceId: inv._id,
      source: 'payable_invoice',
      documentUrl: row.documentUrl,
    })
  }

  for (const inv of paidCustomer) {
    const docs = resolveCustomerInvoiceDocuments(inv)
    rows.push({
      paymentId: inv._id,
      date: inv.paidAt || inv.updatedAt,
      amount: round2(inv.totalAmount),
      relatedTo: 'Customer',
      status: 'Received',
      invoiceNumber: inv.invoiceNumber,
      invoiceId: inv._id,
      source: 'customer_invoice',
      documentUrl: docs.documentUrl,
      pdfUrl: docs.pdfUrl,
      documentType: docs.documentType,
    })
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date))

  let filtered = rows
  if (query.status?.trim()) {
    const want = query.status.trim().toLowerCase()
    filtered = rows.filter((r) => r.status.toLowerCase() === want)
  }
  if (query.search?.trim()) {
    const re = new RegExp(query.search.trim(), 'i')
    filtered = filtered.filter((r) => re.test(r.invoiceNumber || '') || re.test(r.relatedTo))
  }

  const total = filtered.length
  const records = filtered.slice(skip, skip + limit)

  return { records, total, page, limit, leadId }
}

exports.listProjectDeliveries = async (projectId, query = {}) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const { page, limit, skip } = paginate(query)
  const filter = { leadId: lead._id }
  if (query.status) filter.status = query.status

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Delivery.countDocuments(filter),
  ])

  const records = deliveries.map((d) => ({
    deliveryId: d._id,
    deliveryNumber: d.deliveryNumber,
    title: d.description || d.materialType || d.deliveryNumber,
    status: d.status,
    deliveryDate: d.deliveryDate,
    pickupDate: d.pickupDate,
    timeWindow: d.timings || d.deliveryTime || '',
    siteAddress: d.deliveryLocation || d.deliveryLocationData?.address || '',
    materialCategory: d.materialType || d.metalType || '',
    priority: d.priority || 'normal',
  }))

  return {
    records,
    total,
    page,
    limit,
    leadId: lead._id,
    projectName: lead.projectName,
  }
}

const deliveryDetailPopulate = [
  { path: 'leadId', select: 'projectName jobId location customerId', populate: { path: 'customerId', select: 'firstName lastName company email phone' } },
  {
    path: 'selectedCarrierBidId',
    populate: { path: 'carrierId', select: 'carrierName contactName phone email' },
  },
]

exports.getProjectFinalDelivery = async (projectId) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const delivery = await Delivery.findOne({
    leadId: lead._id,
    selectedCarrierBidId: { $ne: null },
    status: { $in: SELECTED_DELIVERY_STATUSES },
  })
    .sort({ updatedAt: -1 })
    .populate(deliveryDetailPopulate)
    .lean()

  if (!delivery) {
    return {
      error: 'No confirmed delivery found for this project',
      code: 404,
    }
  }

  const leadDoc = delivery.leadId && typeof delivery.leadId === 'object' ? delivery.leadId : lead
  const deliveryPayload = await formatAccountDeliveryDetail(delivery, {
    _id: lead._id,
    projectName: leadDoc.projectName || lead.projectName,
    jobId: leadDoc.jobId || lead.jobId,
    customerId: leadDoc.customerId || lead.customerId,
  })

  return { delivery: deliveryPayload, isFinal: true }
}

exports.getProjectDeliveryDetail = async (projectId, deliveryId) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const delivery = await Delivery.findOne({ _id: deliveryId, leadId: lead._id })
    .populate(deliveryDetailPopulate)
    .lean()

  if (!delivery) return { error: 'Delivery not found', code: 404 }

  const deliveryPayload = await formatAccountDeliveryDetail(delivery, lead)
  return { delivery: deliveryPayload }
}

exports.listProjectQuotations = async (projectId, query = {}) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const quotations = await Quotation.find({ leadId: lead._id })
    .sort({ createdAt: -1 })
    .lean()

  let rows = quotations.map((q) => ({
    quotationId: q._id,
    quotationNumber: q.quoteNumber || `QT-${String(q._id).slice(-5).toUpperCase()}`,
    status: q.status,
    approvalStatus: q.approval?.status || 'not_submitted',
    finalPrice: round2(q.finalPrice || q.basePrice || 0),
    proposalDate: q.proposalDate,
    versionNumber: q.versionNumber || 1,
    currency: q.currency || 'USD',
  }))

  if (query.status) rows = rows.filter((r) => r.status === query.status)

  return { quotations: rows, leadId: lead._id, total: rows.length }
}

exports.getProjectQuotationDetail = async (projectId, quotationId) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const quotation = await Quotation.findOne({ _id: quotationId, leadId: lead._id })
    .populate('customerId', 'firstName lastName email company')
    .populate('createdBy', 'name email')
    .lean()

  if (!quotation) return { error: 'Quotation not found', code: 404 }

  return {
    quotation,
    leadId: lead._id,
    projectName: lead.projectName,
    downloadPath: `/api/account/projects/${lead._id}/quotations/${quotation._id}/pdf`,
  }
}

exports.getProjectConsolidatedBom = async (projectId) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const consolidated = await ConsolidatedBOM.findOne({ leadId: lead._id }).lean()
  if (!consolidated) {
    return {
      error: 'Consolidated BOM not found for this project. Plant must generate it first.',
      code: 404,
    }
  }

  return formatAccountConsolidatedBom({ lead, consolidated })
}

/** @deprecated Use getProjectConsolidatedBom — returns same consolidated detail (no per-building bomFiles). */
exports.getProjectBom = async (projectId) => exports.getProjectConsolidatedBom(projectId)

exports.getProjectAgreement = async (projectId) => {
  const { lead, error, code } = await resolveLeadOrError(projectId)
  if (error) return { error, code }

  const contract = findLatestContractDocument(lead)
  let uploadedBy = null
  if (contract?.uploadedBy) {
    uploadedBy = await User.findById(contract.uploadedBy).select('_id name email role').lean()
  }

  return buildAgreementPayload(lead, contract, uploadedBy)
}

exports.buildActionLinks = (lead) => ({
  overview: `/api/account/projects/${lead._id}`,
  invoices: `/api/account/projects/${lead._id}/invoices/summary`,
  invoiceRecords: `/api/account/projects/${lead._id}/invoices/records`,
  payments: `/api/account/projects/${lead._id}/payments/summary`,
  paymentRecords: `/api/account/projects/${lead._id}/payments/records`,
  deliveries: `/api/account/projects/${lead._id}/deliveries`,
  delivery: `/api/account/projects/${lead._id}/delivery`,
  quotations: `/api/account/projects/${lead._id}/quotations`,
  bom: `/api/account/projects/${lead._id}/bom/consolidated`,
  bomLegacy: `/api/account/projects/${lead._id}/bom`,
  agreement: `/api/account/projects/${lead._id}/agreement`,
  projectInvoicesBreakdown: `/api/account/invoices/project/${lead._id}/breakdown`,
  legacy: {
    invoicesQuery: `/api/account/invoices?leadId=${lead._id}`,
    paymentsOrder: `/api/account/payments/orders/${lead._id}`,
  },
})
