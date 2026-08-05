const Escalation = require('../../models/Escalation')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
const auditService = require('../../services/audit.service')
const leadListSocket = require('../../services/leadListSocket.service')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')
const {
  mapEscalationLeadRow,
  ESCALATION_LEAD_POPULATE,
  loadEscalationWithRelations,
} = require('../../utils/escalationLeadRow')

exports.getAllEscalations = asyncHandler(async (req, res) => {
  const { status, assignedSales, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const filter = { ...dateFilter }

  if (status) filter.status = status
  if (assignedSales) {
    const leadIds = await Lead.find({ assignedSales }).distinct('_id')
    filter.leadId = { $in: leadIds }
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const [escalations, total] = await Promise.all([
    Escalation.find(filter)
      .populate(ESCALATION_LEAD_POPULATE)
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean(),
    Escalation.countDocuments(filter),
  ])

  return success(res, {
    leads: escalations.map(mapEscalationLeadRow),
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.resolveEscalation = asyncHandler(async (req, res) => {
  const escalation = await Escalation.findById(req.params.escalationId)
  if (!escalation) return notFound(res, 'Escalation not found')

  const lead = await Lead.findById(escalation.leadId).select('assignedSales').lean()

  escalation.status = 'resolved'
  escalation.resolvedBy = req.user._id
  escalation.resolvedAssignedTo = lead?.assignedSales || escalation.resolvedAssignedTo || null
  escalation.resolvedAt = new Date()
  await escalation.save()

  await auditService.log({
    type: 'escalation', action: AUDIT_ACTIONS.ESCALATION_RESOLVED,
    leadId: escalation.leadId, performedBy: req.user._id,
    metadata: { escalationId: escalation._id, note: req.body.note || '' }
  })

  const populated = await loadEscalationWithRelations(escalation._id)
  return success(res, { lead: mapEscalationLeadRow(populated) }, 'Escalation resolved')
})

exports.assignEscalation = asyncHandler(async (req, res) => {
  const { escalationId } = req.params
  const { employeeId } = req.body

  const [escalation, employee] = await Promise.all([
    Escalation.findById(escalationId),
    User.findById(employeeId),
  ])
  if (!escalation) return notFound(res, 'Escalation not found')
  if (!employee) return notFound(res, 'Employee not found')

  // Resolve escalation
  escalation.status = 'resolved'
  escalation.resolvedBy = req.user._id
  escalation.resolvedAssignedTo = employeeId
  escalation.resolvedAt = new Date()
  await escalation.save()

  // Reassign lead
  const lead = await Lead.findById(escalation.leadId)
  if (lead) {
    lead.assignedSales = employeeId
    lead.isHandedToSales = true
    lead.assigningHistory.push({
      employeeId,
      method: 'manual',
      assignedBy: req.user._id,
      assignedAt: new Date(),
    })
    await lead.save()
  }

  await auditService.log({
    type: 'escalation',
    action: AUDIT_ACTIONS.ESCALATION_RESOLVED,
    leadId: escalation.leadId,
    customerId: escalation.customerId,
    performedBy: req.user._id,
    metadata: { escalationId, assignedTo: employeeId, employeeName: employee.name },
  })

  // Notify newly assigned employee
  const fullLead = await Lead.findById(escalation.leadId).populate('customerId').populate('assignedSales').lean()

  if (global.io) {
    global.io.of('/admin').to(`user:${employeeId}`).emit('lead_assigned', {
      leadId: escalation.leadId,
      lead: fullLead,
    })
  }
  await leadListSocket.emitLeadListUpdated(escalation.leadId, { trigger: 'escalation_reassign' })

  const populated = await loadEscalationWithRelations(escalation._id)
  return success(res, { lead: mapEscalationLeadRow(populated) }, 'Escalation resolved and lead reassigned')
})
