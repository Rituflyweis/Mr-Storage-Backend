const POOrder = require('../../models/POOrder')
const Lead = require('../../models/Lead')
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
    .populate('invoiceId')
    .populate('quotationId')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { orders })
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
  await Lead.findByIdAndUpdate(order.leadId, { poStatus: status })

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
