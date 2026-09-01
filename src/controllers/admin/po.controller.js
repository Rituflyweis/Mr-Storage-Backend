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

const syncLeadOnPOStatus = async (order, status, adminUserId, adminNotes) => {
  const update = { $set: { poStatus: status } }
  if (status === 'approved') {
    update.$set.lifecycleStatus = 'sent_to_admin'
    update.$push = {
      lifecycleHistory: {
        stage: 'sent_to_admin',
        changedAt: new Date(),
        changedBy: adminUserId,
      },
    }
  }
  await Lead.findByIdAndUpdate(order.leadId, update)

  await auditService.log({
    type: 'po',
    action: status === 'approved' ? AUDIT_ACTIONS.LEAD_PO_APPROVED : AUDIT_ACTIONS.LEAD_PO_REJECTED,
    leadId: order.leadId,
    customerId: order.customerId,
    performedBy: adminUserId,
    metadata: { poOrderId: order._id, status, adminNotes: adminNotes || '' },
  })
}

const releasePOToPlant = async (order, assignedTo, adminUserId) => {
  const lead = await Lead.findById(order.leadId)
  const plantUser = await User.findById(assignedTo).select('name role').lean()
  if (!plantUser) return { error: 'Plant user not found', code: 404 }
  if (plantUser.role !== 'plant') return { error: 'assignedTo must be a plant user', code: 400 }

  if (lead) {
    const isFirstRelease = lead.lifecycleStatus !== 'released_to_plant'

    if (isFirstRelease) {
      lead.lifecycleStatus = 'released_to_plant'
      lead.lifecycleHistory.push({
        stage: 'released_to_plant',
        changedAt: new Date(),
        changedBy: adminUserId,
      })
      await lead.save()

      await Building.updateMany({ leadId: order.leadId }, { status: 'drawing_pending' })

      await auditService.log({
        type: 'plant',
        action: AUDIT_ACTIONS.LEAD_RELEASED_TO_PLANT,
        leadId: order.leadId,
        customerId: order.customerId,
        performedBy: adminUserId,
        metadata: {
          poOrderId: order._id,
          assignedTo,
          assignedToName: plantUser.name || '',
          projectName: lead.projectName || '',
        },
      })
    }
  }

  if (global.io) {
    const leadDoc = lead || await Lead.findById(order.leadId).select('projectName').lean()
    global.io.of('/admin').to(`user:${assignedTo}`).emit('project_assigned', {
      leadId: order.leadId,
      poOrderId: order._id,
      projectName: leadDoc?.projectName || '',
    })
  }

  return { lead, plantUser }
}

exports.getAllPOOrders = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (status) filter.status = status

  if (search?.trim()) {
    // poNumber lives directly on POOrder; project/customer names live on the populated refs,
    // so resolve matching leadIds first rather than trying to filter across a populate.
    const Lead = require('../../models/Lead')
    const Customer = require('../../models/Customer')
    const term = search.trim()
    const [leads, customers] = await Promise.all([
      Lead.find({ $or: [{ projectName: { $regex: term, $options: 'i' } }, { jobId: { $regex: term, $options: 'i' } }] }).select('_id').lean(),
      Customer.find({ $or: [{ firstName: { $regex: term, $options: 'i' } }, { lastName: { $regex: term, $options: 'i' } }] }).select('_id').lean(),
    ])
    filter.$or = [
      { poNumber: { $regex: term, $options: 'i' } },
      { leadId: { $in: leads.map((l) => l._id) } },
      { customerId: { $in: customers.map((c) => c._id) } },
    ]
  }

  const orders = await POOrder.find(filter)
    .populate('leadId')
    .populate('customerId')
    .populate('raisedBy')
    .populate('assignedTo', 'name email role')
    .populate('invoiceId', 'invoiceNumber status poNumber paidAt totalAmount')
    .populate('quotationId')
    .sort({ createdAt: -1 })
    .lean()

  const ordersWithPayment = orders.map((o) => {
    const invoiceAmount = o.invoiceId?.totalAmount ?? null

    return {
      ...o,
      leadId: o.leadId && typeof o.leadId === 'object' ? enrichLeadDocument(o.leadId) : o.leadId,
      invoiceAmount,
      invoicePayment: o.invoiceId
        ? {
            status: o.invoiceId.status,
            isPaid: o.invoiceId.status === 'paid',
            amount: invoiceAmount,
          }
        : null,
    }
  })

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

  const result = await releasePOToPlant(order, assignedTo, req.user._id)
  if (result.error) {
    return result.code === 404 ? notFound(res, result.error) : badRequest(res, result.error)
  }

  return success(res, { order })
})

exports.approveAndAssignPOOrder = asyncHandler(async (req, res) => {
  const { poOrderId } = req.params
  const { assignedTo, adminNotes } = req.body

  if (!assignedTo) return badRequest(res, 'assignedTo is required')

  const order = await POOrder.findById(poOrderId)
  if (!order) return notFound(res, 'PO Order not found')
  if (order.status === 'rejected') return badRequest(res, 'Cannot approve a rejected PO order')

  if (order.status === 'pending') {
    order.status = 'approved'
    if (adminNotes) order.adminNotes = adminNotes
    await order.save()
    await syncLeadOnPOStatus(order, 'approved', req.user._id, adminNotes)
  } else if (adminNotes) {
    order.adminNotes = adminNotes
    await order.save()
  }

  order.assignedTo = assignedTo
  await order.save()

  const result = await releasePOToPlant(order, assignedTo, req.user._id)
  if (result.error) {
    return result.code === 404 ? notFound(res, result.error) : badRequest(res, result.error)
  }

  const populated = await POOrder.findById(order._id)
    .populate('assignedTo', 'name email role')
    .populate('invoiceId', 'invoiceNumber status poNumber paidAt totalAmount')
    .lean()

  return success(res, { order: populated }, 'PO Order approved and assigned to plant')
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

  await syncLeadOnPOStatus(order, status, req.user._id, adminNotes)

  return success(res, { order }, `PO Order ${status}`)
})
