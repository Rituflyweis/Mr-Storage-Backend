const Expense = require('../models/Expense')
const FreightBid = require('../models/FreightBid')
const Delivery = require('../models/Delivery')
const PaymentApproval = require('../models/PaymentApproval')
const Invoice = require('../models/Invoice')
const generatePaymentApprovalId = require('../utils/generatePaymentApprovalId')
const costsPanel = require('./accountCostsPanel.service')

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100

const formatMoney = (n) => round2(n)

const paymentStatusLabel = (approval) => {
  if (!approval) return 'Pending'
  if (approval.paidAt || approval.status === 'approved') return 'Paid'
  if (approval.status === 'under_review') return 'Under Review'
  return 'Pending'
}

const deliveryDocumentLinks = (delivery = {}) => {
  const links = []
  if (delivery.documentUrl) {
    links.push({ label: 'Proof of Delivery (POD)', url: delivery.documentUrl, type: 'pod' })
  }
  const attachments = Array.isArray(delivery.attachments) ? delivery.attachments : []
  attachments.forEach((url, idx) => {
    if (!url) return
    links.push({
      label: idx === 0 ? 'Delivery Receipt' : idx === 1 ? 'Bill of Lading' : `Attachment ${idx + 1}`,
      url,
      type: 'attachment',
    })
  })
  return links
}

exports.markManpowerPaid = async (id) => {
  const expense = await Expense.findOne({ _id: id, costPanelType: 'manpower', isActive: true })
  if (!expense) return null
  expense.status = 'paid'
  await expense.save()
  return costsPanel.getManpowerRecordById(id)
}

exports.markRentPaid = async (id) => {
  const expense = await Expense.findOne({ _id: id, costPanelType: 'rent', isActive: true })
  if (!expense) return null
  expense.status = 'paid'
  if (expense.metadata) expense.metadata.scheduleStatus = 'Paid'
  expense.markModified('metadata')
  await expense.save()
  return costsPanel.getRentRecordById(id)
}

exports.getFreightCostDetail = async (bidId) => {
  const bid = await FreightBid.findOne({ _id: bidId, status: 'selected' })
    .populate('carrierId', 'carrierName email phone')
    .populate({
      path: 'deliveryId',
      populate: { path: 'leadId', select: 'projectName jobId location' },
    })
    .lean()
  if (!bid) return null

  const delivery = bid.deliveryId
  const deliveryId = delivery?._id
  const allBids = deliveryId
    ? await FreightBid.find({
        deliveryId,
        status: { $in: ['submitted', 'selected'] },
        quotedAmount: { $ne: null },
      })
        .populate('carrierId', 'carrierName')
        .lean()
    : []

  const amounts = allBids.map((b) => Number(b.quotedAmount)).filter((n) => n > 0)
  const awarded = round2(bid.quotedAmount)
  const averageBid = amounts.length ? round2(amounts.reduce((s, n) => s + n, 0) / amounts.length) : awarded
  const highestBid = amounts.length ? round2(Math.max(...amounts)) : awarded
  const savings = round2(Math.max(0, highestBid - awarded))

  const approval = await PaymentApproval.findOne({ linkedType: 'freight_bid', linkedId: bidId }).lean()
  let invoice = null
  if (bid.payableInvoiceId) {
    invoice = await Invoice.findById(bid.payableInvoiceId)
      .select('invoiceNumber date dueDate status pdfUrl documentUrl totalAmount')
      .lean()
  }

  const payLabel = paymentStatusLabel(approval)
  const invoiceStatus = invoice?.status === 'paid' ? 'Paid' : approval?.status === 'under_review' ? 'Under Review' : payLabel === 'Paid' ? 'Invoiced' : 'Pending'

  return {
    bidId: bid._id,
    freightRequestId: `FR-${String(bid._id).slice(-5).toUpperCase()}`,
    totalLoads: delivery?.packageCount || 1,
    totalFreightCost: awarded,
    totalFreightCostFormatted: formatMoney(awarded),
    paymentStatus: payLabel,
    invoiceStatus,
    status: invoiceStatus,
    bidSummary: {
      awardedCarrier: bid.carrierId?.carrierName || '',
      awardedBid: awarded,
      averageBid,
      highestBid,
      savings,
      savingsPct: highestBid > 0 ? round2((savings / highestBid) * 100) : 0,
    },
    costComparison: allBids.map((b) => ({
      bidId: b._id,
      carrierName: b.carrierId?.carrierName || '',
      amount: round2(b.quotedAmount),
      selected: String(b._id) === String(bid._id),
    })),
    projectInformation: {
      projectName: delivery?.leadId?.projectName || '',
      leadId: delivery?.leadId?._id || null,
      deliveryDate: delivery?.deliveryDate || bid.estimatedDeliveryDate || null,
      deliveryId: delivery?.deliveryNumber || '',
      deliveryMongoId: delivery?._id || null,
    },
    carrierInformation: {
      carrier: bid.carrierId?.carrierName || '',
      carrierId: bid.carrierId?._id || null,
      freightCost: awarded,
      paymentStatus: payLabel,
    },
    deliveryLink: {
      deliveryStatus: delivery?.status || '',
      documents: deliveryDocumentLinks(delivery),
    },
    invoiceDetails: invoice
      ? {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.date,
          paymentDueDate: invoice.dueDate,
          invoiceStatus,
          amount: round2(invoice.totalAmount),
          downloadUrl: invoice.pdfUrl || invoice.documentUrl || '',
        }
      : approval
        ? {
            invoiceNumber: approval.invoiceNumber || approval.paymentId,
            invoiceDate: approval.createdAt,
            paymentDueDate: approval.dueDate,
            invoiceStatus,
            amount: round2(approval.amount),
            downloadUrl: '',
          }
        : null,
    approvalId: approval?._id || null,
    canMarkPaid: payLabel !== 'Paid',
  }
}

exports.markFreightPaid = async (bidId, userId) => {
  const bid = await FreightBid.findOne({ _id: bidId, status: 'selected' })
    .populate('carrierId', 'carrierName')
    .populate('deliveryId')
    .lean()
  if (!bid) return null

  let approval = await PaymentApproval.findOne({ linkedType: 'freight_bid', linkedId: bidId })
  if (!approval) {
    approval = await PaymentApproval.create({
      paymentId: await generatePaymentApprovalId(),
      payee: bid.carrierId?.carrierName || 'Carrier',
      payeeType: 'carrier',
      category: 'other_expenses',
      amount: Number(bid.quotedAmount) || 0,
      requestedBy: userId,
      leadId: bid.deliveryId?.leadId || null,
      linkedType: 'freight_bid',
      linkedId: bidId,
      invoiceNumber: `FR-${String(bidId).slice(-5).toUpperCase()}`,
      status: 'approved',
      paidAt: new Date(),
      reviewedBy: userId,
      reviewedAt: new Date(),
    })
  } else {
    approval.status = 'approved'
    approval.paidAt = new Date()
    approval.reviewedBy = userId
    approval.reviewedAt = new Date()
    await approval.save()
  }

  return exports.getFreightCostDetail(bidId)
}

exports.getLogisticsCostDetail = async (approvalId) => {
  const approval = await PaymentApproval.findOne({
    _id: approvalId,
    payeeType: { $in: ['carrier', 'delivery_company'] },
  })
    .populate('leadId', 'projectName jobId location')
    .lean()
  if (!approval) return null

  let delivery = null
  let freightBid = null
  if (approval.linkedType === 'delivery' && approval.linkedId) {
    delivery = await Delivery.findById(approval.linkedId).lean()
  } else if (approval.linkedType === 'freight_bid' && approval.linkedId) {
    freightBid = await FreightBid.findById(approval.linkedId).populate('deliveryId').lean()
    delivery = freightBid?.deliveryId || null
  }

  const amount = round2(approval.amount)
  const payLabel = paymentStatusLabel(approval)
  const invoiceStatus =
    approval.status === 'under_review' ? 'Under Review' : payLabel === 'Paid' ? 'Invoiced' : 'Pending'

  return {
    id: approval._id,
    loadId: approval.paymentId,
    deliveryId: delivery?.deliveryNumber || approval.invoiceNumber || '',
    deliveryMongoId: delivery?._id || null,
    totalLogisticsCost: amount,
    totalLogisticsCostFormatted: formatMoney(amount),
    invoiceStatus,
    paymentStatus: payLabel,
    projectInformation: {
      projectName: approval.leadId?.projectName || '',
      leadId: approval.leadId?._id || null,
      deliveryDate: delivery?.deliveryDate || freightBid?.estimatedDeliveryDate || null,
      deliveryId: delivery?.deliveryNumber || '',
    },
    carrierInformation: {
      carrier: approval.payee,
      logisticCost: amount,
      paymentStatus: payLabel,
    },
    deliveryLink: {
      deliveryStatus: delivery?.status || '',
      documents: deliveryDocumentLinks(delivery),
    },
    invoiceDetails: {
      invoiceNumber: approval.invoiceNumber || approval.paymentId,
      invoiceDate: approval.createdAt,
      paymentDueDate: approval.dueDate,
      invoiceStatus,
      amount,
      downloadUrl: '',
    },
    canMarkPaid: payLabel !== 'Paid',
    approvalStatus: approval.status === 'approved' ? 'Approved' : 'Pending',
  }
}

exports.markLogisticsPaid = async (approvalId, userId) => {
  const approval = await PaymentApproval.findOne({
    _id: approvalId,
    payeeType: { $in: ['carrier', 'delivery_company'] },
  })
  if (!approval) return null

  approval.status = 'approved'
  approval.paidAt = new Date()
  approval.reviewedBy = userId
  approval.reviewedAt = new Date()
  await approval.save()

  return exports.getLogisticsCostDetail(approvalId)
}
