const crypto = require('crypto')
const Invoice = require('../models/Invoice')
const User = require('../models/User')
const generatePayableInvoiceNumber = require('./generatePayableInvoiceNumber')
const { computeInvoiceDueDate } = require('./invoiceDueDate')
const { loadFreightLoadDetailsByLeadId } = require('../services/plant/freightLoadDetails.service')
const { redactPayableLinkedSecrets } = require('./payablePublicBootstrap.util')

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
    vendorId: inv.vendorId?._id || inv.vendorId || null,
    carrierId: inv.carrierId?._id || inv.carrierId || null,
    projectName: inv.leadId?.projectName || '—',
    jobId: inv.leadId?.jobId || '',
    leadId: inv.leadId?._id || inv.leadId,
    amount: inv.totalAmount ?? 0,
    totalAmount: inv.totalAmount ?? 0,
    dueDate: inv.dueDate,
    date: inv.date,
    category: inv.category,
    description: inv.description || '',
    status: inv.status,
    payableStatus,
    paymentLabel,
    payableWorkflow: inv.payableWorkflow || null,
    documentUrl: wf.documentUrl || '',
    documentFileName: wf.documentFileName || '',
    source: wf.source || null,
    shipperRequestId: wf.shipperRequestId?._id || wf.shipperRequestId || null,
    freightBidId: wf.freightBidId?._id || wf.freightBidId || null,
    deliveryId: wf.deliveryId?._id || wf.deliveryId || null,
    paidAt: inv.paidAt,
    paymentMethod: inv.paymentMethod || null,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
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

const populatePayableQuery = (q) =>
  q
    .populate('leadId')
    .populate('vendorId')
    .populate('carrierId')
    .populate('createdBy', 'name email role')
    .populate('paidBy', 'name email role')
    .populate({
      path: 'payableWorkflow.shipperRequestId',
      populate: [
        { path: 'vendorId' },
        { path: 'leadId' },
        { path: 'reviewedBy', select: 'name email' },
        { path: 'consolidatedBOMId', select: 'status fileUrl' },
      ],
    })
    .populate({
      path: 'payableWorkflow.freightBidId',
      populate: [{ path: 'carrierId' }],
    })
    .populate('payableWorkflow.deliveryId')
    .populate('payableWorkflow.adminReviewedBy', 'name email')
    .populate('payableWorkflow.accountPaymentUpdatedBy', 'name email')
    .populate('payableWorkflow.comments.authorId', 'name email role')

const enrichPayableForDetailResponse = async (invoice) => {
  const sanitized = redactPayableLinkedSecrets(invoice)
  const leadId = sanitized.leadId?._id || sanitized.leadId
  const loadDetails = leadId
    ? await loadFreightLoadDetailsByLeadId(leadId)
    : { bundlePlan: null, packingListPlan: null, bundles: [], packingLists: [] }

  const delivery =
    sanitized.payableWorkflow?.deliveryId && typeof sanitized.payableWorkflow.deliveryId === 'object'
      ? sanitized.payableWorkflow.deliveryId
      : null

  return {
    invoice: sanitized,
    row: buildPayableListRow(sanitized),
    delivery,
    loadDetails,
  }
}

module.exports = {
  ensurePayableUploadToken,
  buildPayableListRow,
  syncTopLevelStatusFromPayable,
  createPayableInvoice,
  mapLegacyStatus,
  populatePayableQuery,
  enrichPayableForDetailResponse,
}
