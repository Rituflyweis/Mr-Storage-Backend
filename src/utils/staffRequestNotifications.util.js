const Lead = require('../models/Lead')
const notificationService = require('../services/notification.service')

const projectLabelFromLead = (lead) => lead?.jobId || lead?.projectName || ''

const loadLeadProjectContext = async (leadId) => {
  if (!leadId) return { lead: null, projectLabel: '' }
  const lead = await Lead.findById(leadId).select('projectName jobId assignedSales customerId').lean()
  return { lead, projectLabel: projectLabelFromLead(lead) }
}

const buildRequestBody = ({ entityLabel, entityRef, projectLabel, suffix }) => {
  const parts = [entityLabel, entityRef, projectLabel].filter(Boolean)
  const core = parts.length ? parts.join(' — ') : entityLabel || 'Request'
  if (suffix) return `${core}. ${suffix}`.trim()
  return `${core} needs review.`
}

/** Every active user with role `admin`. */
const notifyAdmins = (payload) => notificationService.notifyRole('admin', payload)

/** Every active user with role `account`. */
const notifyAccounts = (payload) => notificationService.notifyRole('account', payload)

const notifyPlant = (payload) => notificationService.notifyRole('plant', payload)

const notifyConstruction = (payload) => notificationService.notifyRole('construction', payload)

const notifyStaffUser = (userId, payload) => {
  if (!userId) return null
  return notificationService.notify({ ...payload, userId })
}

const notifyLeadOwner = (leadId, payload) => notificationService.notifyLeadOwner(leadId, payload)

const notifyCustomer = (payload) => {
  if (!payload?.customerId) return null
  return notificationService.notify(payload)
}

const notifyAdminsApprovalRequest = async ({
  title,
  entityLabel,
  entityRef,
  leadId,
  refId,
  refModel,
  type,
  note = '',
  priority = 'high',
}) => {
  const { projectLabel } = await loadLeadProjectContext(leadId)
  const body = buildRequestBody({
    entityLabel,
    entityRef,
    projectLabel,
    suffix: note || 'Needs admin approval.',
  })
  return notifyAdmins({ leadId, title, body, type, priority, refId, refModel })
}

const notifyAccountsApprovalRequest = async ({
  title,
  entityLabel,
  entityRef,
  leadId,
  refId,
  refModel,
  type = 'payment',
  note = '',
  priority = 'high',
}) => {
  const { projectLabel } = await loadLeadProjectContext(leadId)
  const body = buildRequestBody({
    entityLabel,
    entityRef,
    projectLabel,
    suffix: note || 'Needs accounts review.',
  })
  return notifyAccounts({ leadId, title, body, type, priority, refId, refModel })
}

const notifySubmitterOutcome = ({
  userId,
  leadId,
  title,
  body,
  refId,
  refModel,
  type,
  priority = 'medium',
}) => notifyStaffUser(userId, { leadId, title, body, type, priority, refId, refModel })

const notifyPaymentApprovalCreated = async (approval, { note } = {}) => {
  if (!approval?._id) return null
  return notifyAccountsApprovalRequest({
    title: 'Payment approval requested',
    entityLabel: approval.payee || 'Payment',
    entityRef: approval.paymentId || approval.invoiceNumber || '',
    leadId: approval.leadId,
    refId: approval._id,
    refModel: 'PaymentApproval',
    type: 'payment',
    note,
  })
}

const notifyPaymentApprovalReviewed = async (approval, action, reviewNotes = '') => {
  if (!approval?.requestedBy) return null
  const actionLabel = String(action || '').replace(/_/g, ' ')
  const extra = reviewNotes ? `: ${reviewNotes}` : ''
  return notifySubmitterOutcome({
    userId: approval.requestedBy,
    leadId: approval.leadId,
    title: `Payment ${actionLabel}`,
    body: `${approval.paymentId || approval.payee || 'Payment request'} was ${actionLabel}${extra}.`,
    type: 'payment',
    priority: action === 'rejected' || action === 'disputed' ? 'high' : 'medium',
    refId: approval._id,
    refModel: 'PaymentApproval',
  })
}

const payableTypeLabel = (invoice) =>
  invoice?.invoiceType === 'freight_carrier' ? 'Freight payable' : 'Vendor payable'

/** Vendor / carrier invoice submitted (admin queue). */
const notifyVendorPayablePendingAdmin = async (invoice) => {
  if (!invoice?._id || invoice.payableWorkflow?.status !== 'pending_admin_approval') return null
  return notifyAdminsApprovalRequest({
    title: `${payableTypeLabel(invoice)} pending approval`,
    entityLabel: payableTypeLabel(invoice),
    entityRef: invoice.invoiceNumber || '',
    leadId: invoice.leadId,
    refId: invoice._id,
    refModel: 'Invoice',
    type: 'payment',
    note: 'Review before accounts can pay.',
  })
}

const notifyVendorPayableApprovedForAccounts = async (invoice) =>
  notifyAccountsApprovalRequest({
    title: 'Payable approved for payment',
    entityLabel: payableTypeLabel(invoice),
    entityRef: invoice.invoiceNumber || '',
    leadId: invoice.leadId,
    refId: invoice._id,
    refModel: 'Invoice',
    type: 'payment',
    note: 'Admin approved — process in accounts.',
  })

const notifyVendorPayableRejected = async (invoice, reason = '') =>
  notifySubmitterOutcome({
    userId: invoice.createdBy,
    leadId: invoice.leadId,
    title: 'Payable invoice rejected',
    body: `${invoice.invoiceNumber || 'Invoice'} was rejected${reason ? `: ${reason}` : ''}.`,
    type: 'payment',
    priority: 'high',
    refId: invoice._id,
    refModel: 'Invoice',
  })

const notifyPoOrderStatus = async (order, status, adminNotes = '') => {
  if (!order?.raisedBy || !['approved', 'rejected'].includes(status)) return null
  const lead = order.leadId
    ? await Lead.findById(order.leadId).select('projectName jobId').lean()
    : null
  const projectLabel = lead?.jobId || lead?.projectName || 'PO'
  return notifySubmitterOutcome({
    userId: order.raisedBy,
    leadId: order.leadId,
    title: `PO order ${status}`,
    body: `${projectLabel} — PO ${order.poNumber || ''} was ${status}${adminNotes ? `: ${adminNotes}` : ''}.`,
    type: 'system',
    priority: status === 'rejected' ? 'high' : 'medium',
    refId: order._id,
    refModel: 'POOrder',
  })
}

const notifyDrawingReviewedForUploader = async ({
  uploadedBy,
  leadId,
  fileName,
  status,
  note = '',
  refId,
  refModel = 'Building',
}) => {
  if (!uploadedBy) return null
  const action = status === 'approved' ? 'approved' : 'needs revision'
  return notifyStaffUser(uploadedBy, {
    leadId,
    title: `Drawing ${action}`,
    body: `${fileName || 'Drawing'} was ${action}${note ? `: ${note}` : ''}.`,
    type: 'drawing',
    priority: status === 'rejected' ? 'high' : 'medium',
    refId,
    refModel,
  })
}

module.exports = {
  notifyAdmins,
  notifyAccounts,
  notifyPlant,
  notifyConstruction,
  notifyStaffUser,
  notifyLeadOwner,
  notifyCustomer,
  notifyAdminsApprovalRequest,
  notifyAccountsApprovalRequest,
  notifySubmitterOutcome,
  notifyPaymentApprovalCreated,
  notifyPaymentApprovalReviewed,
  notifyVendorPayablePendingAdmin,
  notifyVendorPayableApprovedForAccounts,
  notifyVendorPayableRejected,
  notifyPoOrderStatus,
  notifyDrawingReviewedForUploader,
  loadLeadProjectContext,
  buildRequestBody,
}
