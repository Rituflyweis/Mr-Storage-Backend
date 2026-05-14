const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Message = require('../../models/Message')
const Quotation = require('../../models/Quotation')
const QuoteSummary = require('../../models/QuoteSummary')
const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const FollowUp = require('../../models/FollowUp')
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
  const { search, buildingType, lifecycleStatus, isQuoteReady, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const filter = { assignedSales: req.user._id, ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (search && search.trim()) {
    const term = search.trim()
    const regex = new RegExp(term, 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [
        { firstName: regex },
        { email: regex },
        { customerId: regex },
      ],
    }).distinct('_id')

    filter.$or = [
      { projectName: regex },
      { buildingType: regex },
      { location: regex },
      { customerId: { $in: matchingCustomerIds } },
    ]
  }

  const skip = (parsedPage - 1) * parsedLimit
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .select('_id projectName customerId lifecycleStatus quoteValue leadScoring buildingType location')
      .populate({ path: 'customerId', select: 'firstName email' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const leadIds = leads.map(l => l._id)
  const nextFollowUpByLeadId = new Map()
  if (leadIds.length > 0) {
    const pendingFollowUps = await FollowUp.find({
      leadId: { $in: leadIds },
      status: 'pending',
    })
      .select('_id leadId followUpDate notes priority')
      .sort({ followUpDate: 1 })
      .lean()

    for (const followUp of pendingFollowUps) {
      const key = String(followUp.leadId)
      if (!nextFollowUpByLeadId.has(key)) {
        nextFollowUpByLeadId.set(key, {
          _id: followUp._id,
          followUpDate: followUp.followUpDate,
          notes: followUp.notes,
          priority: followUp.priority,
        })
      }
    }
  }

  const normalizedLeads = leads.map(lead => ({
    _id: lead._id,
    projectName: lead.projectName || '',
    customerId: lead.customerId
      ? {
        _id: lead.customerId._id,
        firstName: lead.customerId.firstName || '',
        email: lead.customerId.email || '',
      }
      : null,
    lifecycleStatus: lead.lifecycleStatus,
    quoteValue: lead.quoteValue || 0,
    leadScoring: { score: lead.leadScoring?.score || 0 },
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    nextFollowUp: nextFollowUpByLeadId.get(String(lead._id)) || null,
  }))

  return success(res, { leads: normalizedLeads, total, page: parsedPage, limit: parsedLimit })
})

exports.getLeadsStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)

  const [totalLeads, leadsClosed, followUpPending, escalationsPending] = await Promise.all([
    Lead.countDocuments({ assignedSales: salesId, ...dateFilter }),
    Lead.countDocuments({
      assignedSales: salesId,
      lifecycleStatus: { $in: CLOSED_STAGES },
      ...dateFilter,
    }),
    FollowUp.countDocuments({ assignedTo: salesId, status: 'pending', ...dateFilter }),
    Escalation.countDocuments({ raisedBy: salesId, status: 'pending', ...dateFilter }),
  ])

  return success(res, { totalLeads, leadsClosed, followUpPending, escalationsPending })
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
