const Notification = require('../models/Notification')
const User = require('../models/User')
const Lead = require('../models/Lead')

/**
 * Single write point for all in-app notifications. Call this everywhere an event happens that a
 * user or customer should be told about. Never write to Notification directly outside this file.
 * Fails silently — a notification failure should never break the business action that triggered it.
 *
 * refId/refModel let the frontend deep-link straight to the relevant screen from the notification
 * (e.g. refModel: 'Delivery', refId: delivery._id -> navigate to that delivery's detail view).
 */
const notify = async ({
  userId = null,
  customerId = null,
  leadId = null,
  title,
  body = '',
  type = 'system',
  priority = 'medium',
  refId = null,
  refModel = null,
}) => {
  if (!userId && !customerId) return null
  if (!title) return null
  try {
    return await Notification.create({ userId, customerId, leadId, title, body, type, priority, refId, refModel })
  } catch (err) {
    console.error('[Notification] Write failed:', err.message)
    return null
  }
}

/** Notify several staff users at once with the same content (e.g. all admins, or a project's assigned staff). */
const notifyUsers = async (userIds, payload) => {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map(String))]
  return Promise.all(uniqueIds.map((userId) => notify({ ...payload, userId })))
}

/** Notify every active staff member with the given role(s) — e.g. all 'admin' or all 'plant'. */
const notifyRole = async (roles, payload) => {
  const roleList = Array.isArray(roles) ? roles : [roles]
  const users = await User.find({ role: { $in: roleList }, isActive: true }).select('_id').lean()
  return notifyUsers(users.map((u) => u._id), payload)
}

/** Notify a lead's assigned sales rep, if any. */
const notifyLeadOwner = async (leadId, payload) => {
  const lead = await Lead.findById(leadId).select('assignedSales').lean()
  if (!lead?.assignedSales) return null
  return notify({ ...payload, userId: lead.assignedSales, leadId })
}

module.exports = { notify, notifyUsers, notifyRole, notifyLeadOwner }
