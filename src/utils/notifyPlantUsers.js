const POOrder = require('../models/POOrder')

const notifyPlantUsersForLead = async (leadId, eventName, payload) => {
  if (!global.io || !leadId) return

  const plantUserIds = await POOrder.distinct('assignedTo', {
    leadId,
    status: 'approved',
    assignedTo: { $ne: null },
  })

  for (const userId of plantUserIds) {
    global.io.of('/admin').to(`user:${userId}`).emit(eventName, payload)
  }
}

module.exports = {
  notifyPlantUsersForLead,
}
