const PaymentApproval = require('../models/PaymentApproval')
const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const {
  round2,
  resolveApprovalStatusLabel,
  resolveApprovalWorkflowStage,
  resolveCategoryLabel,
  paymentApprovalPriority,
  mapRemarksForUi,
  mapAttachmentsForUi,
  mapHistoryForUi,
  buildSyntheticHistoryIfEmpty,
} = require('../utils/paymentApprovalPresentation.util')

const INVOICE_TYPE_LABELS = {
  vendor: 'Vendor',
  shipper: 'Shipper',
  department: 'Department',
  carrier: 'Carrier',
  delivery_company: 'Delivery Company',
}

const loadApprovalDetailContext = async (approvalId) => {
  const approval = await PaymentApproval.findById(approvalId)
    .populate('requestedBy', 'name email')
    .populate('reviewedBy', 'name email')
    .populate('leadId', 'projectName jobId location')
    .populate('remarks.author', 'name email')
    .populate('attachments.uploadedBy', 'name email')
    .populate('activityLog.user', 'name email')
    .lean()
  if (!approval) return null

  let delivery = null
  let freightBid = null
  if (approval.linkedType === 'delivery' && approval.linkedId) {
    delivery = await Delivery.findById(approval.linkedId).lean()
  } else if (approval.linkedType === 'freight_bid' && approval.linkedId) {
    freightBid = await FreightBid.findById(approval.linkedId)
      .populate('carrierId', 'carrierName phone email')
      .populate('deliveryId')
      .lean()
    delivery = freightBid?.deliveryId || null
  }

  return { approval, delivery, freightBid }
}

const buildPaymentApprovalDetailPayload = (approval, delivery, freightBid, { canReviewPendingOnly = false } = {}) => {
  const amount = round2(approval.amount)
  const costBreakdown = {
    baseFreight: round2(amount * 0.89),
    fuelSurcharge: round2(amount * 0.07),
    handlingFee: round2(amount * 0.04),
    total: amount,
  }

  const route =
    delivery?.pickupLocation && delivery?.deliveryLocation
      ? `${delivery.pickupLocation} → ${delivery.deliveryLocation}`
      : ''

  const statusLabel = resolveApprovalStatusLabel(approval)
  const workflowStage = resolveApprovalWorkflowStage(approval)
  const canReview = canReviewPendingOnly
    ? approval.status === 'pending'
    : ['pending', 'under_review'].includes(approval.status)

  const activitySource = (approval.activityLog && approval.activityLog.length)
    ? approval.activityLog
    : buildSyntheticHistoryIfEmpty(approval)

  const additionalNotes = [approval.notes, approval.reviewNotes].filter(Boolean).join('\n\n').trim()

  return {
    approvalId: approval._id,
    paymentId: approval.paymentId,
    status: approval.status,
    statusLabel,
    workflowStage,
    canReview,
    header: {
      payee: approval.payee,
      companyName: approval.payee,
      category: approval.category,
      categoryLabel: resolveCategoryLabel(approval.category),
      requestedBy: approval.requestedBy,
      requestedAt: approval.createdAt,
      invoiceNumber: approval.invoiceNumber || '',
      dueDate: approval.dueDate,
      amount,
    },
    details: {
      additionalNotes,
      hasAdditionalDetails: Boolean(additionalNotes)
        || Boolean(approval.linkedType)
        || Boolean(approval.leadId)
        || Boolean(delivery),
      invoiceDetails: {
        invoiceAmount: amount,
        status: approval.status === 'pending' ? 'Pending Approval' : statusLabel,
        paymentDueDate: approval.dueDate,
        paymentPriority: paymentApprovalPriority(approval.dueDate),
      },
      companyInformation: {
        companyName: approval.payee,
        deliveryDate: delivery?.deliveryDate || freightBid?.estimatedDeliveryDate || null,
        deliveryId: delivery?.deliveryNumber || '',
      },
      costBreakdown,
      linkedTransaction: {
        freightRequestId: approval.paymentId,
        loadId: delivery?.deliveryNumber || '',
        projectName: approval.leadId?.projectName || '',
        linkedDeliveryId: delivery?._id || null,
        linkedDeliveryNumber: delivery?.deliveryNumber || '',
        route,
      },
      project: approval.leadId
        ? {
          leadId: approval.leadId._id,
          projectName: approval.leadId.projectName,
          jobId: approval.leadId.jobId,
          location: approval.leadId.location,
        }
        : null,
    },
    reviews: {
      remarks: mapRemarksForUi(
        approval.remarks || [],
        approval.leadId?.projectName || approval.department || ''
      ),
    },
    attachments: mapAttachmentsForUi(approval.attachments || []),
    history: mapHistoryForUi(approval, activitySource),
    invoiceNumber: approval.invoiceNumber,
    invoiceType: INVOICE_TYPE_LABELS[approval.payeeType] || approval.payeeType,
    invoiceTypeCode: approval.payeeType,
    companyName: approval.payee,
    invoiceDetails: {
      invoiceAmount: amount,
      status: approval.status === 'pending' ? 'Pending Approval' : statusLabel,
      paymentDueDate: approval.dueDate,
      paymentPriority: paymentApprovalPriority(approval.dueDate),
    },
    companyInformation: {
      companyName: approval.payee,
      deliveryDate: delivery?.deliveryDate || freightBid?.estimatedDeliveryDate || null,
      deliveryId: delivery?.deliveryNumber || '',
    },
    costBreakdown,
    linkedTransaction: {
      freightRequestId: approval.paymentId,
      loadId: delivery?.deliveryNumber || '',
      projectName: approval.leadId?.projectName || '',
      linkedDeliveryId: delivery?._id || null,
      linkedDeliveryNumber: delivery?.deliveryNumber || '',
      route,
    },
    project: approval.leadId
      ? {
        leadId: approval.leadId._id,
        projectName: approval.leadId.projectName,
        jobId: approval.leadId.jobId,
        location: approval.leadId.location,
      }
      : null,
    requestedBy: approval.requestedBy,
    reviewedBy: approval.reviewedBy,
    reviewNotes: approval.reviewNotes,
    category: approval.category,
    categoryLabel: resolveCategoryLabel(approval.category),
    amount,
    dueDate: approval.dueDate,
    paidAt: approval.paidAt,
    notes: approval.notes,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    reviewedAt: approval.reviewedAt,
  }
}

const appendPaymentApprovalActivity = async (approvalDoc, { type, label, userId }) => {
  if (!approvalDoc.activityLog) approvalDoc.activityLog = []
  approvalDoc.activityLog.push({
    at: new Date(),
    type,
    label,
    user: userId || null,
  })
}

const addPaymentApprovalRemark = async (approvalId, userId, text) => {
  const approval = await PaymentApproval.findById(approvalId)
  if (!approval) return { error: 'not_found' }
  const trimmed = String(text || '').trim()
  if (!trimmed) return { error: 'bad_request', message: 'Remark text is required' }

  if (!approval.remarks) approval.remarks = []
  approval.remarks.push({ text: trimmed, author: userId })
  await appendPaymentApprovalActivity(approval, {
    type: 'remark',
    label: 'Remark added',
    userId,
  })
  await approval.save()
  return { approval }
}

const addPaymentApprovalAttachment = async (approvalId, userId, { name, url, fileSize }) => {
  const approval = await PaymentApproval.findById(approvalId)
  if (!approval) return { error: 'not_found' }
  const fileUrl = String(url || '').trim()
  if (!fileUrl) return { error: 'bad_request', message: 'url is required' }

  if (!approval.attachments) approval.attachments = []
  approval.attachments.push({
    name: name || '',
    url: fileUrl,
    fileSize: Number(fileSize) || 0,
    uploadedBy: userId,
  })
  await appendPaymentApprovalActivity(approval, {
    type: 'attachment',
    label: 'Attachment uploaded',
    userId,
  })
  await approval.save()
  return { approval }
}

module.exports = {
  INVOICE_TYPE_LABELS,
  loadApprovalDetailContext,
  buildPaymentApprovalDetailPayload,
  appendPaymentApprovalActivity,
  addPaymentApprovalRemark,
  addPaymentApprovalAttachment,
}
