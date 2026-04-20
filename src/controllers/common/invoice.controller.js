const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const PaymentSchedule = require('../../models/PaymentSchedule')
const mailer = require('../../services/email/mailer')
const auditService = require('../../services/audit.service')
const generateInvoiceNumber = require('../../utils/generateInvoiceNumber')
const generatePONumber = require('../../utils/generatePONumber')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')

const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

exports.createInvoice = asyncHandler(async (req, res) => {
  const { leadId } = req.body
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

  const ALLOWED_CREATE = [
    'quotationId','date','daysToPay','lineItems',
    'subtotal','markupTotal','discount','depositAmount','totalAmount',
  ]
  const invoiceData = {}
  ALLOWED_CREATE.forEach(k => { if (req.body[k] !== undefined) invoiceData[k] = req.body[k] })

  const invoice = await Invoice.create({
    ...invoiceData,
    invoiceNumber,
    poNumber,
    createdBy: req.user._id,
    leadId,
    customerId: lead.customerId,
  })

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

  const paymentSchedule = await PaymentSchedule.findOne({ invoiceId: invoice._id }).lean()
  return success(res, { invoice, paymentSchedule })
})

exports.updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (invoice.status !== 'draft') return badRequest(res, 'Only draft invoices can be edited')

  const ALLOWED_UPDATE = [
    'quotationId','date','daysToPay','lineItems',
    'subtotal','markupTotal','discount','depositAmount','totalAmount',
  ]
  ALLOWED_UPDATE.forEach(k => { if (req.body[k] !== undefined) invoice[k] = req.body[k] })
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
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')

  const customer = await Customer.findById(invoice.customerId)
  if (!customer) return notFound(res, 'Customer not found')

  await mailer.sendInvoice({
    toEmail: customer.email,
    customerName: customer.firstName,
    invoice,
  })

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
  if (['draft', 'cancelled'].includes(invoice.status)) {
    return badRequest(res, 'Cannot mark a draft or cancelled invoice as paid')
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
