const POOrder = require('../../models/POOrder')
const Lead = require('../../models/Lead')
const Quotation = require('../../models/Quotation')
const AuditLog = require('../../models/AuditLog')
const User = require('../../models/User')
const Building = require('../../models/Building')
const auditService = require('../../services/audit.service')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, PO_STATUSES } = require('../../config/constants')
const { enrichLeadDocument } = require('../../utils/leadProjectId')

exports.getAllPOOrders = asyncHandler(async (req, res) => {
  const { status } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (status) filter.status = status

  const orders = await POOrder.find(filter)
    .populate('leadId')
    .populate('customerId')
    .populate('raisedBy')
    .populate('assignedTo', 'name email role')
    .populate('invoiceId', 'invoiceNumber status poNumber paidAt')
    .populate('quotationId')
    .sort({ createdAt: -1 })
    .lean()

  const ordersWithPayment = orders.map((o) => ({
    ...o,
    leadId: o.leadId && typeof o.leadId === 'object' ? enrichLeadDocument(o.leadId) : o.leadId,
    invoicePayment: o.invoiceId
      ? {
          status: o.invoiceId.status,
          isPaid: o.invoiceId.status === 'paid',
        }
      : null,
  }))

  return success(res, { orders: ordersWithPayment })
})

exports.getPOOrderDetail = asyncHandler(async (req, res) => {
  const { poOrderId } = req.params

  const order = await POOrder.findById(poOrderId)
    .populate('raisedBy', 'name email role')
    .populate('assignedTo', 'name email role')
    .populate('invoiceId')
    .lean()
  if (!order) return notFound(res, 'PO Order not found')

  const [lead, quotation, auditLog] = await Promise.all([
    Lead.findById(order.leadId)
      .populate({ path: 'customerId', select: '-password' })
      .populate({ path: 'assignedSales', select: 'name email role' })
      .lean(),
    order.quotationId
      ? Quotation.findById(order.quotationId)
        .populate('createdBy', 'name email role')
        .populate('assignedSalesperson', 'name email role')
        .lean()
      : null,
    AuditLog.find({ leadId: order.leadId })
      .populate('performedBy', 'name email role')
      .sort({ createdAt: 1 })
      .lean(),
  ])

  if (!lead) return notFound(res, 'Lead not found')

  const enrichedLead = enrichLeadDocument(lead)

  return success(res, {
    order,
    lead: enrichedLead,
    quotation,
    customer: lead.customerId,
    auditLog,
  })
})

exports.assignPOOrder = asyncHandler(async (req, res) => {
  const { poOrderId } = req.params
  const { assignedTo } = req.body

  const order = await POOrder.findById(poOrderId)
  if (!order) return notFound(res, 'PO Order not found')
  if (order.status !== 'approved') return badRequest(res, 'Can only assign approved PO orders')

  order.assignedTo = assignedTo
  await order.save()

  const lead = await Lead.findById(order.leadId)
  const plantUser = await User.findById(assignedTo).select('name').lean()
  if (lead) {
    lead.lifecycleStatus = 'released_to_plant'
    lead.lifecycleHistory.push({
      stage: 'released_to_plant',
      changedAt: new Date(),
      changedBy: req.user._id,
    })
    await lead.save()

    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.LEAD_RELEASED_TO_PLANT,
      leadId: order.leadId,
      customerId: order.customerId,
      performedBy: req.user._id,
      metadata: {
        poOrderId: order._id,
        assignedTo,
        assignedToName: plantUser?.name || '',
        projectName: lead.projectName || '',
      },
    })
  }

  // Transition all buildings for this project to drawing_pending
  await Building.updateMany({ leadId: order.leadId }, { status: 'drawing_pending' })

  // Notify the assigned plant user via socket
  if (global.io) {
    const leadDoc = lead || await Lead.findById(order.leadId).select('projectName').lean()
    global.io.of('/admin').to(`user:${assignedTo}`).emit('project_assigned', {
      leadId: order.leadId,
      poOrderId: order._id,
      projectName: leadDoc?.projectName || '',
    })
  }

  return success(res, { order })
})

exports.updatePOStatus = asyncHandler(async (req, res) => {
  const { poOrderId } = req.params
  const { status, adminNotes } = req.body

  if (!PO_STATUSES.includes(status)) return badRequest(res, 'Invalid status')

  const order = await POOrder.findById(poOrderId)
  if (!order) return notFound(res, 'PO Order not found')

  order.status = status
  if (adminNotes) order.adminNotes = adminNotes
  await order.save()

  // Sync to lead
  const leadUpdate = { poStatus: status }
  if (status === 'approved') {
    leadUpdate.lifecycleStatus = 'sent_to_admin'
    leadUpdate.$push = {
      lifecycleHistory: { stage: 'sent_to_admin', changedAt: new Date(), changedBy: req.user._id },
    }
  }
  await Lead.findByIdAndUpdate(order.leadId, leadUpdate)

  await auditService.log({
    type: 'po',
    action: status === 'approved' ? AUDIT_ACTIONS.LEAD_PO_APPROVED : AUDIT_ACTIONS.LEAD_PO_REJECTED,
    leadId: order.leadId,
    customerId: order.customerId,
    performedBy: req.user._id,
    metadata: { poOrderId, status, adminNotes },
  })

  return success(res, { order }, `PO Order ${status}`)
})
