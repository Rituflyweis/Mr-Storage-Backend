const POOrder = require('../models/POOrder')
const notificationService = require('../services/notification.service')

/** Plant users with an approved PO assignment on this lead. */
const getPlantUserIdsForLead = async (leadId) => {
  if (!leadId) return []
  const plantUserIds = await POOrder.distinct('assignedTo', {
    leadId,
    status: 'approved',
    assignedTo: { $ne: null },
  })
  return [...new Set(plantUserIds.filter(Boolean).map(String))]
}

/** Emit a socket event to every plant user assigned to the lead (`/admin` → `user:{id}`). */
const notifyPlantUsersForLead = async (leadId, eventName, payload) => {
  if (!global.io || !leadId || !eventName) return []

  const plantUserIds = await getPlantUserIdsForLead(leadId)
  for (const userId of plantUserIds) {
    global.io.of('/admin').to(`user:${userId}`).emit(eventName, payload)
  }
  return plantUserIds
}

/**
 * In-app Notification rows + realtime socket for plant assignees on a lead.
 * Use for customer drawing approve/revision and similar plant-facing alerts.
 */
const alertPlantUsersForLead = async (
  leadId,
  {
    eventName,
    socketPayload = {},
    notification,
  } = {}
) => {
  const plantUserIds = await getPlantUserIdsForLead(leadId)
  if (!plantUserIds.length) return { plantUserIds: [], notifications: [] }

  let notifications = []
  if (notification?.title) {
    notifications = await notificationService.notifyUsers(plantUserIds, {
      ...notification,
      leadId,
    })
  }

  if (global.io && eventName) {
    for (const userId of plantUserIds) {
      global.io.of('/admin').to(`user:${userId}`).emit(eventName, {
        leadId: String(leadId),
        ...socketPayload,
      })
    }
  }

  return { plantUserIds, notifications }
}

module.exports = {
  getPlantUserIdsForLead,
  notifyPlantUsersForLead,
  alertPlantUsersForLead,
}
