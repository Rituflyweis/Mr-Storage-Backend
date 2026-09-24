const crypto = require('crypto')
const User = require('../models/User')
const generatePayableInvoiceNumber = require('./generatePayableInvoiceNumber')
const { computeInvoiceDueDate } = require('./invoiceDueDate')

const ensurePayableUploadToken = () => crypto.randomBytes(32).toString('hex')

const resolveFallbackCreatedBy = async (preferredUserId) => {
  if (preferredUserId) return preferredUserId
  const admin = await User.findOne({ role: 'admin', isActive: { $ne: false } }).select('_id').lean()
  if (!admin) throw new Error('No admin user available for payable invoice creation')
  return admin._id
}

const buildPayableListRow = (inv) => {
  const wf = inv.payableWorkflow || {}
  const legacy = !inv.payableWorkflow
  const payableStatus = legacy ? mapLegacyStatus(inv.status) : wf.status
  const paymentLabel =
    payableStatus === 'paid'
      ? 'Completed'
      : payableStatus === 'approved_for_payment' || payableStatus === 'unpaid'
        ? 'Pending'
        : payableStatus === 'pending_admin_approval'
          ? 'Awaiting admin'
          : payableStatus === 'rejected'
            ? 'Rejected'
            : '—'

  return {
    _id: inv._id,
    invoiceNumber: inv.invoiceNumber,
    invoiceType: inv.invoiceType,
    vendorName: inv.vendorId?.vendorName || inv.payeeName || '—',
    carrierName: inv.carrierId?.carrierName || inv.payeeName || '—',
    projectName: inv.leadId?.projectName || '—',
    jobId: inv.leadId?.jobId || '',
    leadId: inv.leadId?._id || inv.leadId,
    amount: inv.totalAmount ?? 0,
    dueDate: inv.dueDate,
    date: inv.date,
    category: inv.category,
    status: inv.status,
    payableStatus,
    paymentLabel,
    payableWorkflow: inv.payableWorkflow || null,
    documentUrl: wf.documentUrl || '',
    source: wf.source || null,
    paidAt: inv.paidAt,
    createdAt: inv.createdAt,
  }
}

const mapLegacyStatus = (status) => {
  if (status === 'paid') return 'paid'
  if (status === 'overdue' || status === 'sent') return 'approved_for_payment'
  if (status === 'draft') return 'pending_admin_approval'
  return 'unpaid'
}

const syncTopLevelStatusFromPayable = (invoice) => {
  const st = invoice.payableWorkflow?.status
  if (!st) return
  if (st === 'paid') invoice.status = 'paid'
  else if (st === 'rejected') invoice.status = 'cancelled'
  else if (st === 'approved_for_payment' || st === 'unpaid') invoice.status = 'sent'
  else if (st === 'pending_admin_approval') invoice.status = 'draft'
}

const createPayableInvoice = async ({
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
  source,
  createdBy,
  shipperRequestId,
  freightBidId,
  deliveryId,
  initialPayableStatus,
}) => {
  const createdById = await resolveFallbackCreatedBy(createdBy)
  const invoiceNumber = await generatePayableInvoiceNumber(invoiceType)
  const invoiceDate = date ? new Date(date) : new Date()
  const dueDate = computeInvoiceDueDate(invoiceDate, daysToPay ?? 30)

  const payableStatus = initialPayableStatus || 'pending_admin_approval'

  const invoice = await Invoice.create({
    leadId,
    customerId: null,
    invoiceType,
    category: category || null,
    vendorId: vendorId || null,
    carrierId: carrierId || null,
    payeeName: payeeName || '',
    createdBy: createdById,
    invoiceNumber,
    description: description || '',
    date: invoiceDate,
    daysToPay: daysToPay ?? 30,
    dueDate,
    totalAmount: Number(totalAmount) || 0,
    subtotal: Number(totalAmount) || 0,
    status: 'draft',
    payableWorkflow: {
      status: payableStatus,
      source: source || 'admin_manual',
      documentUrl: documentUrl || '',
      documentFileName: documentFileName || '',
      shipperRequestId: shipperRequestId || null,
      freightBidId: freightBidId || null,
      deliveryId: deliveryId || null,
      comments: [],
    },
  })

  syncTopLevelStatusFromPayable(invoice)
  await invoice.save()
  return invoice
}

module.exports = {
  ensurePayableUploadToken,
  buildPayableListRow,
  syncTopLevelStatusFromPayable,
  createPayableInvoice,
  mapLegacyStatus,
}
