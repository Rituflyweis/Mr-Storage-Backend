const Lead = require('../models/Lead')
const User = require('../models/User')
const RoundRobinTracker = require('../models/RoundRobinTracker')
const auditService = require('./audit.service')
const { AUDIT_ACTIONS } = require('../config/constants')

/**
 * Rebuilds the activeEmployees list from DB.
 * Call whenever a User's isActive or role changes.
 */
const rebuildTracker = async () => {
  const salesEmployees = await User.find({ role: 'sales', isActive: true }).select('_id').lean()
  const ids = salesEmployees.map(u => u._id)

  let tracker = await RoundRobinTracker.findOne()
  if (!tracker) {
    tracker = await RoundRobinTracker.create({ lastAssignedIndex: -1, activeEmployees: ids })
  } else {
    // Compare current vs new list — if contents changed, reset index so no employee is skipped
    const currentIds = tracker.activeEmployees.map(id => String(id)).sort()
    const newIds     = ids.map(id => String(id)).sort()
    const listChanged = JSON.stringify(currentIds) !== JSON.stringify(newIds)

    tracker.activeEmployees = ids
    if (listChanged || tracker.lastAssignedIndex >= ids.length) {
      tracker.lastAssignedIndex = -1
    }
    await tracker.save()
  }
  return tracker
}

/**
 * Assigns the next sales employee in round-robin order to a lead.
 * Returns the assigned employeeId, or null if no active sales employees.
 */
const assignNextSales = async (leadId, customerId) => {
  // Ensure tracker exists before the atomic increment
  let tracker = await RoundRobinTracker.findOne()
  if (!tracker) tracker = await rebuildTracker()

  if (!tracker.activeEmployees || tracker.activeEmployees.length === 0) {
    console.warn('[RoundRobin] No active sales employees — lead left unassigned:', leadId)
    if (global.io) {
      global.io.of('/admin').to('admin_room').emit('lead_no_sales_available', { leadId })
    }
    return null
  }

  // Atomic increment — eliminates TOCTOU race when two leads are ready simultaneously
  const updated = await RoundRobinTracker.findOneAndUpdate(
    {},
    { $inc: { lastAssignedIndex: 1 } },
    { new: true }
  )
  const employeeId = updated.activeEmployees[updated.lastAssignedIndex % updated.activeEmployees.length]

  // Update lead
  await Lead.findByIdAndUpdate(leadId, {
    assignedSales: employeeId,
    isHandedToSales: true,
    $push: {
      assigningHistory: {
        employeeId,
        method: 'auto',
        assignedAt: new Date(),
        assignedBy: null,
      },
    },
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_ASSIGNED_AUTO,
    leadId,
    customerId,
    performedBy: null,
    metadata: { assignedTo: employeeId },
  })

  // Load full lead with customer for the socket payload
  // Sales employee needs full context to immediately understand the lead
  const fullLead = await Lead.findById(leadId)
    .populate('customerId')
    .populate('assignedSales')
    .lean()

  // Notify the assigned employee with full lead context
  if (global.io) {
    global.io.of('/admin').to(`user:${employeeId}`).emit('lead_assigned', {
      leadId,
      lead: fullLead,
    })
  }

  return employeeId
}

module.exports = { assignNextSales, rebuildTracker }
