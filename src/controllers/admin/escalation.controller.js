const Escalation = require('../../models/Escalation')
const Lead = require('../../models/Lead')
const User = require('../../models/User')
const auditService = require('../../services/audit.service')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS } = require('../../config/constants')

exports.getAllEscalations = asyncHandler(async (req, res) => {
  const { status } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (status) filter.status = status

  const escalations = await Escalation.find(filter)
    .populate('leadId')
    .populate('customerId')
    .populate('raisedBy')
    .populate('resolvedAssignedTo')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { escalations })
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

  return success(res, { escalation }, 'Escalation resolved and lead reassigned')
})
