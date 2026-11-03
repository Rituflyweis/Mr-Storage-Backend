const Lead = require('../models/Lead')
const {
  notifyAdmins,
  notifyLeadOwner,
  notifyCustomer,
  notifyStaffUser,
} = require('./staffRequestNotifications.util')
const notificationService = require('../services/notification.service')

const materialPriority = (priority) =>
  priority === 'critical' || priority === 'high' ? 'high' : 'medium'

const resolveLeadId = (mr) => {
  if (!mr?.leadId) return null
  return typeof mr.leadId === 'object' ? mr.leadId._id : mr.leadId
}

/** New material request / customer order — route to the right panel(s). */
exports.notifyMaterialRequestCreated = async (mr) => {
  if (!mr?._id) return
  const leadId = resolveLeadId(mr)
  const itemCount = Array.isArray(mr.requestedItems) ? mr.requestedItems.length : 0
  const lead =
    typeof mr.leadId === 'object' && mr.leadId?.projectName
      ? mr.leadId
      : leadId
        ? await Lead.findById(leadId).select('projectName jobId assignedSales customerId').lean()
        : null
  const projectLabel = lead?.jobId || lead?.projectName || 'Project'
  const label = mr.requestId || String(mr._id).slice(-6)
  const body = `${label} — ${projectLabel} (${itemCount} item(s)).`
  const base = {
    leadId,
    body,
    type: 'material_request',
    priority: materialPriority(mr.priority),
    refId: mr._id,
    refModel: 'MaterialRequest',
  }

  if (mr.source === 'customer') {
    await notifyAdmins({ ...base, title: 'Customer material order' })
    await notifyLeadOwner(leadId, { ...base, title: 'Customer material order', priority: 'medium' })
  }

  await notificationService.notifyRole('plant', {
    ...base,
    title: mr.source === 'customer' ? 'New customer order' : 'New material request',
  })
}

/** Status change on a material request — notify whoever raised it. */
exports.notifyMaterialRequestReviewed = async (mr, status, reviewNotes = '') => {
  if (!mr?._id || !['approved', 'rejected', 'fulfilled', 'cancelled'].includes(status)) return
  const leadId = resolveLeadId(mr)
  const suffix = reviewNotes ? `: ${reviewNotes}` : '.'
  const body = `Request ${mr.requestId || mr._id} was ${status}${suffix}`
  const payload = {
    leadId,
    title: `Material request ${status}`,
    body,
    type: 'material_request',
    priority: status === 'rejected' ? 'high' : 'medium',
    refId: mr._id,
    refModel: 'MaterialRequest',
  }

  if (mr.requestedBy) {
    await notifyStaffUser(mr.requestedBy, payload)
  }
  if (mr.requestedByCustomer) {
    await notifyCustomer({ ...payload, customerId: mr.requestedByCustomer })
  }
}
