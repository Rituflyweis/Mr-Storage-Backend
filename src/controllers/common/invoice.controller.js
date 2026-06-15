const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const PaymentSchedule = require('../../models/PaymentSchedule')
const mailer = require('../../services/email/mailer')
const auditService = require('../../services/audit.service')
const generateInvoiceNumber = require('../../utils/generateInvoiceNumber')
const generatePONumber = require('../../utils/generatePONumber')
const { success, created, notFound, badRequest, forbidden, error } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { isInvoiceOverdue, resolveInvoiceLeadIds, getScopedLeadIds } = require('../../utils/invoiceScope')
const { AUDIT_ACTIONS, INVOICE_STATUSES } = require('../../config/constants')
const { generateInvoiceListExcel, generateInvoiceListPdf } = require('../../utils/exportInvoices')

const INVOICE_BODY_FIELDS = [
  'date', 'daysToPay', 'lineItems', 'description',
  'subtotal', 'markupTotal', 'tax', 'discount', 'depositAmount', 'totalAmount',
]

const INVOICE_EDITABLE_STATUSES = ['draft', 'sent']

const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

const applyInvoiceBodyFields = (target, body) => {
  INVOICE_BODY_FIELDS.forEach(k => {
    if (body[k] !== undefined) target[k] = body[k]
  })
}

const resolvePaymentScheduleStage = async (leadId, paymentScheduleStageId) => {
  const schedule = await PaymentSchedule.findOne({ leadId, 'stages._id': paymentScheduleStageId })
    .select('_id')
    .lean()
  if (!schedule) return { error: 'Payment schedule stage not found for this project' }
  return { paymentScheduleId: schedule._id, paymentScheduleStageId }
}

const setPaymentScheduleStageInvoiced = async (leadId, paymentScheduleStageId, invoiceId) => {
  await PaymentSchedule.findOneAndUpdate(
    { leadId, 'stages._id': paymentScheduleStageId },
    { $set: { 'stages.$.invoiceId': invoiceId, 'stages.$.status': 'invoiced' } }
  )
}

const unlinkInvoiceFromPaymentStage = async (leadId, paymentScheduleStageId, invoiceId) => {
  if (!paymentScheduleStageId) return
  const schedule = await PaymentSchedule.findOne({
    leadId,
    'stages._id': paymentScheduleStageId,
    'stages.invoiceId': invoiceId,
  }).lean()
  if (!schedule) return

  const stage = schedule.stages.find(s => String(s._id) === String(paymentScheduleStageId))
  const resetStatus = stage?.status === 'invoiced' ? 'pending' : stage?.status

  await PaymentSchedule.findOneAndUpdate(
    { leadId, 'stages._id': paymentScheduleStageId },
    {
      $set: {
        'stages.$.invoiceId': null,
        ...(resetStatus ? { 'stages.$.status': resetStatus } : {}),
      },
    }
  )
}

const applyPaymentScheduleStageLink = async (invoice, paymentScheduleStageId) => {
  const previousStageId = invoice.paymentScheduleStageId

  if (previousStageId && String(previousStageId) !== String(paymentScheduleStageId || '')) {
    await unlinkInvoiceFromPaymentStage(invoice.leadId, previousStageId, invoice._id)
  }

  if (paymentScheduleStageId) {
    const resolved = await resolvePaymentScheduleStage(invoice.leadId, paymentScheduleStageId)
    if (resolved.error) return resolved
    invoice.paymentScheduleId = resolved.paymentScheduleId
    invoice.paymentScheduleStageId = resolved.paymentScheduleStageId
    await setPaymentScheduleStageInvoiced(invoice.leadId, paymentScheduleStageId, invoice._id)
  } else {
    invoice.paymentScheduleId = null
    invoice.paymentScheduleStageId = null
  }

  return {}
}

exports.createInvoice = asyncHandler(async (req, res) => {
  const leadId = req.params.leadId
  if (!leadId) return badRequest(res, 'leadId is required in the URL path')

  const { lead, error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const invoiceNumber = await generateInvoiceNumber()

  // PO number logic:
  // First invoice on this lead: auto-generate a new PO number
  // Second+ invoice on same lead: carry forward the first invoice's PO number
  const existingInvoice = await Invoice.findOne({ leadId }).sort({ createdAt: 1 }).lean()
  let poNumber
  if (existingInvoice?.poNumber) {
    poNumber = existingInvoice.poNumber
  } else {
    poNumber = await generatePONumber()
  }

  const invoiceData = {}
  applyInvoiceBodyFields(invoiceData, req.body)

  const { paymentScheduleStageId } = req.body
  let paymentScheduleId = null

  if (paymentScheduleStageId) {
    const resolved = await resolvePaymentScheduleStage(leadId, paymentScheduleStageId)
    if (resolved.error) return badRequest(res, resolved.error)
    paymentScheduleId = resolved.paymentScheduleId
  }

  const invoice = await Invoice.create({
    ...invoiceData,
    invoiceNumber,
    poNumber,
    createdBy: req.user._id,
    leadId,
    customerId: lead.customerId,
    quotationId: null,
    paymentScheduleId,
    paymentScheduleStageId: paymentScheduleStageId || null,
  })

  if (paymentScheduleStageId) {
    await setPaymentScheduleStageInvoiced(leadId, paymentScheduleStageId, invoice._id)
  }

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.INVOICE_CREATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { invoiceNumber, totalAmount: invoice.totalAmount },
  })

  return created(res, { invoice })
})

exports.getInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
    .populate('createdBy')
    .populate('paidBy')
    .lean()
  if (!invoice) return notFound(res, 'Invoice not found')

  const { error: accessError, code } = await checkLeadAccess(invoice.leadId, req.user)
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError)

  const paymentSchedule = await PaymentSchedule.findOne({ leadId: invoice.leadId }).lean()
  return success(res, { invoice, paymentSchedule })
})

exports.updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (invoice.status === 'cancelled') return badRequest(res, 'Cancelled invoices cannot be edited')

  const { error, code } = await checkLeadAccess(invoice.leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const hasPaymentStageUpdate = req.body.paymentScheduleStageId !== undefined
  const hasBodyFieldUpdates = INVOICE_BODY_FIELDS.some(k => req.body[k] !== undefined)

  if (hasBodyFieldUpdates && !INVOICE_EDITABLE_STATUSES.includes(invoice.status)) {
    return badRequest(res, 'Only draft and sent invoices can be edited')
  }

  if (hasBodyFieldUpdates) {
    applyInvoiceBodyFields(invoice, req.body)
  }

  if (hasPaymentStageUpdate) {
    if (!INVOICE_EDITABLE_STATUSES.includes(invoice.status)) {
      return badRequest(res, 'Payment schedule stage can only be changed on draft or sent invoices')
    }
    const linkResult = await applyPaymentScheduleStageLink(invoice, req.body.paymentScheduleStageId)
    if (linkResult.error) return badRequest(res, linkResult.error)
  }

  await invoice.save()

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.INVOICE_EDITED,
    leadId: invoice.leadId,
    customerId: invoice.customerId,
    performedBy: req.user._id,
    metadata: { invoiceId: invoice._id },
  })

  return success(res, { invoice })
})


exports.sendInvoice = asyncHandler(async (req, res) => {
  if (!mailer.isSmtpConfigured()) {
    return badRequest(res, 'Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.')
  }

  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (invoice.status === 'paid') return badRequest(res, 'Paid invoices cannot be sent')
  if (invoice.status === 'cancelled') return badRequest(res, 'Cancelled invoices cannot be sent')

  const { error: accessError, code } = await checkLeadAccess(invoice.leadId, req.user)
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError)

  const customer = await Customer.findById(invoice.customerId)
  if (!customer) return notFound(res, 'Customer not found')
  if (!customer.email) return badRequest(res, 'Customer has no email address on file')

  try {
    await mailer.sendInvoice({
      toEmail: customer.email,
      customerName: customer.firstName,
      invoice,
    })
  } catch (err) {
    console.error('[sendInvoice] Email failed for invoice', invoice.invoiceNumber, err.message)
    return error(res, `Failed to send invoice email: ${err.message}`, 502)
  }

  invoice.status = 'sent'
  invoice.sentAt = new Date()
  await invoice.save()

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.INVOICE_SENT,
    leadId: invoice.leadId,
    customerId: invoice.customerId,
    performedBy: req.user._id,
    metadata: { invoiceNumber: invoice.invoiceNumber, sentTo: customer.email },
  })

  return success(res, { invoice }, 'Invoice sent successfully')
})

exports.markAsPaid = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (invoice.status === 'paid') return badRequest(res, 'Invoice is already marked as paid')
  if (invoice.status === 'cancelled') {
    return badRequest(res, 'Cannot mark a cancelled invoice as paid')
  }

  // Check access for sales role
  if (req.user.role === 'sales') {
    const lead = await Lead.findById(invoice.leadId)
    if (lead && String(lead.assignedSales) !== String(req.user._id)) {
      return forbidden(res, 'Access denied')
    }
  }

  invoice.status = 'paid'
  invoice.paidAt = new Date()
  invoice.paidBy = req.user._id
  await invoice.save()

  // Auto-update linked payment schedule stage
  if (invoice.paymentScheduleStageId) {
    const PaymentSchedule = require('../../models/PaymentSchedule')
    await PaymentSchedule.findOneAndUpdate(
      { 'stages._id': invoice.paymentScheduleStageId },
      { $set: { 'stages.$.status': 'paid', 'stages.$.paidAt': new Date(), 'stages.$.paidBy': req.user._id } }
    )
    await auditService.log({
      type: 'invoice',
      action: AUDIT_ACTIONS.PAYMENT_STAGE_PAID,
      leadId: invoice.leadId,
      customerId: invoice.customerId,
      performedBy: req.user._id,
      metadata: { stageId: invoice.paymentScheduleStageId, invoiceId: invoice._id },
    })
  }

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.INVOICE_PAID,
    leadId: invoice.leadId,
    customerId: invoice.customerId,
    performedBy: req.user._id,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      paidBy: req.user._id,
      paidByName: req.user.name,
    },
  })

  return success(res, { invoice }, 'Invoice marked as paid')
})

exports.getLeadInvoices = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const dateFilter = buildDateFilter(req.query)

  const invoices = await Invoice.find({ leadId, ...dateFilter })
    .populate('createdBy')
    .populate('paidBy')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { invoices })
})

exports.getInvoiceStats = asyncHandler(async (req, res) => {
  const { leadId } = req.query  
  const scopedLeadIds = await getScopedLeadIds(req.user)
  const filter = { status: { $ne: 'cancelled' } }

  if (scopedLeadIds !== null) {
    filter.leadId = { $in: scopedLeadIds }
  }

  // ← leadId param aaye toh override karo global filter
  if (leadId) {
    filter.leadId = leadId
  }

  const invoices = await Invoice.find(filter)
    .select('status totalAmount dueDate date daysToPay')
    .lean()

  const now = new Date()
  let totalAmount = 0
  let totalPaid = 0
  let totalUnpaid = 0
  let overdue = 0

  for (const inv of invoices) {
    const amt = inv.totalAmount || 0
    totalAmount += amt
    if (inv.status === 'paid') {
      totalPaid += amt
    } else if (isInvoiceOverdue(inv, now)) {
      overdue += amt
    } else if (['draft', 'sent'].includes(inv.status)) {
      totalUnpaid += amt
    }
  }

  return success(res, { totalAmount, totalPaid, totalUnpaid, overdue })
})

exports.listInvoices = asyncHandler(async (req, res) => {
  const { status, leadId, search, page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(1, Number(page) || 1)
  const parsedLimit = Math.min(Math.max(1, Number(limit) || 20), 100)
  const skip = (parsedPage - 1) * parsedLimit

  if (status && !INVOICE_STATUSES.includes(status)) {
    return badRequest(res, `Invalid status. Use: ${INVOICE_STATUSES.join(', ')}`)
  }

  const { leadIds } = await resolveInvoiceLeadIds(req.user, { search, leadId })
  const filter = { ...buildDateFilter(req.query, 'createdAt') }
  if (status) filter.status = status

  if (leadIds !== null) {
    if (leadIds.length === 0) {
      return success(res, { invoices: [], total: 0, page: parsedPage, limit: parsedLimit })
    }
    filter.leadId = { $in: leadIds }
  }

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .populate('createdBy', 'name email')
      .populate('paidBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Invoice.countDocuments(filter),
  ])

  const leadIdSet = new Set(invoices.map(i => String(i.leadId)))
  const leadRows = leadIdSet.size
    ? await Lead.find({ _id: { $in: [...leadIdSet] } }).select('_id projectName').lean()
    : []
  const projectNameByLead = Object.fromEntries(leadRows.map(l => [String(l._id), l.projectName || '']))

  const rows = invoices.map(inv => ({
    invoiceNumber: inv.invoiceNumber,
    projectName: projectNameByLead[String(inv.leadId)] || '',
    dueDate: inv.dueDate,
    amount: inv.totalAmount,
    status: inv.status,
    invoice: inv,
  }))

  return success(res, {
    invoices: rows,
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})


exports.exportInvoices = asyncHandler(async (req, res) => {
  const { format = 'excel', status, leadId, search } = req.query

  if (status && !INVOICE_STATUSES.includes(status)) {
    return badRequest(res, `Invalid status. Use: ${INVOICE_STATUSES.join(', ')}`)
  }

  // ✅ Same filter logic as listInvoices (no pagination)
  const { leadIds } = await resolveInvoiceLeadIds(req.user, { search, leadId })
  const filter = { ...buildDateFilter(req.query, 'createdAt') }
  if (status) filter.status = status

  if (leadIds !== null) {
    if (leadIds.length === 0) {
      return badRequest(res, 'No matching invoices found to export')
    }
    filter.leadId = { $in: leadIds }
  }

  const invoices = await Invoice.find(filter)
    .populate('customerId', 'firstName lastName email')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .lean()

  // Attach projectName same as listInvoices
  const leadIdSet = new Set(invoices.map(i => String(i.leadId)))
  const leadRows = leadIdSet.size
    ? await Lead.find({ _id: { $in: [...leadIdSet] } }).select('_id projectName').lean()
    : []
  const projectNameByLead = Object.fromEntries(leadRows.map(l => [String(l._id), l.projectName || '']))

  const rows = invoices.map(inv => ({
    ...inv,
    projectName: projectNameByLead[String(inv.leadId)] || '—',
  }))

  if (format === 'pdf') {
    const buffer = await generateInvoiceListPdf(rows)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.pdf"')
    return res.send(buffer)
  }

  const buffer = await generateInvoiceListExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"')
  return res.send(buffer)
})