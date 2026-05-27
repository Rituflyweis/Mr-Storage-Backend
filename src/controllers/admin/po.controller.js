const POOrder = require('../../models/POOrder')
const Lead = require('../../models/Lead')
const Building = require('../../models/Building')
const auditService = require('../../services/audit.service')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, PO_STATUSES } = require('../../config/constants')

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
    invoicePayment: o.invoiceId
      ? {
          status: o.invoiceId.status,
          isPaid: o.invoiceId.status === 'paid',
        }
      : null,
  }))

  return success(res, { orders: ordersWithPayment })
})

exports.assignPOOrder = asyncHandler(async (req, res) => {
  const { poOrderId } = req.params
  const { assignedTo } = req.body

  const order = await POOrder.findById(poOrderId)
  if (!order) return notFound(res, 'PO Order not found')
  if (order.status !== 'approved') return badRequest(res, 'Can only assign approved PO orders')

  order.assignedTo = assignedTo
  await order.save()

  // Transition all buildings for this project to drawing_pending
  await Building.updateMany({ leadId: order.leadId }, { status: 'drawing_pending' })

  // Notify the assigned plant user via socket
  if (global.io) {
    const lead = await Lead.findById(order.leadId).select('projectName').lean()
    global.io.of('/admin').to(`user:${assignedTo}`).emit('project_assigned', {
      leadId: order.leadId,
      poOrderId: order._id,
      projectName: lead?.projectName || '',
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
