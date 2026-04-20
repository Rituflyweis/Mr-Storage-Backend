const Lead = require('../../models/Lead')
const Message = require('../../models/Message')
const Quotation = require('../../models/Quotation')
const QuoteSummary = require('../../models/QuoteSummary')
const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const Escalation = require('../../models/Escalation')
const POOrder = require('../../models/POOrder')
const auditService = require('../../services/audit.service')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES, CLOSED_STAGES } = require('../../config/constants')

// Guard: ensure lead belongs to this sales user
const guardLead = async (leadId, salesId) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', status: 404 }
  if (String(lead.assignedSales) !== String(salesId)) return { error: 'Access denied', status: 403 }
  return { lead }
}

exports.getLeads = asyncHandler(async (req, res) => {
  const { buildingType, lifecycleStatus, isQuoteReady, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { assignedSales: req.user._id, ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'

  const skip = (parseInt(page) - 1) * parseInt(limit)
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate('customerId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { leads, total, page: parseInt(page), limit: parseInt(limit) })
})

exports.getLeadDetail = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const populatedLead = await Lead.findById(leadId)
    .populate('customerId')
    .populate('assignedSales')
    .lean()

  const [quotation, invoices, messages] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).populate('paidBy').sort({ createdAt: -1 }).lean(),
    Message.find({ leadId }).sort({ createdAt: -1 }).limit(20).lean().then(m => m.reverse()),
  ])

  let quoteSummary = null
  let paymentSchedule = null
  if (quotation) quoteSummary = await QuoteSummary.findOne({ quotationId: quotation._id }).lean()
  if (invoices.length > 0) paymentSchedule = await PaymentSchedule.findOne({ invoiceId: invoices[0]._id }).lean()

  return success(res, {
    lead: populatedLead,
    quotation,
    quoteSummary,
    invoices,
    paymentSchedule,
    recentMessages: messages,
    documents: populatedLead.documents || [],
  })
})

exports.updateLifecycle = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lifecycleStatus } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  if (!LIFECYCLE_STAGES.includes(lifecycleStatus)) return badRequest(res, 'Invalid lifecycle status')

  lead.lifecycleStatus = lifecycleStatus
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_LIFECYCLE_UPDATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { lifecycleStatus },
  })

  return success(res, { lead })
})

exports.escalateLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { note } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const escalation = await Escalation.create({
    leadId,
    customerId: lead.customerId,
    raisedBy: req.user._id,
    note,
  })

  await auditService.log({
    type: 'escalation',
    action: AUDIT_ACTIONS.LEAD_ESCALATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { note },
  })

  if (global.io) {
    global.io.of('/admin').to('admin_room').emit('new_escalation', {
      escalation,
      leadId,
      raisedBy: req.user.name,
    })
  }

  return success(res, { escalation }, 'Lead escalated successfully')
})

exports.raisePOOrder = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { poNumber, invoiceId, quotationId } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const order = await POOrder.create({
    leadId,
    customerId: lead.customerId,
    raisedBy: req.user._id,
    invoiceId,
    quotationId,
    poNumber,
  })

  lead.isRaisedToPO = true
  await lead.save()

  await auditService.log({
    type: 'po',
    action: AUDIT_ACTIONS.LEAD_PO_RAISED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { poNumber },
  })

  if (global.io) {
    global.io.of('/admin').to('admin_room').emit('new_po_order', { order, leadId })
  }

  return success(res, { order }, 'PO Order raised successfully')
})

exports.getProjects = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const leads = await Lead.find({
    assignedSales: req.user._id,
    lifecycleStatus: { $in: CLOSED_STAGES },
    ...dateFilter,
  })
    .populate('customerId')
    .sort({ updatedAt: -1 })
    .lean()

  return success(res, { projects: leads })
})

exports.getMyPOOrders = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const orders = await POOrder.find({ raisedBy: req.user._id, ...dateFilter })
    .populate('leadId')
    .populate('invoiceId')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { orders })
})
