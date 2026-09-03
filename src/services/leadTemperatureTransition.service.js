const LeadTemperatureTransition = require('../models/LeadTemperatureTransition')

const logLeadTemperatureTransition = async ({
  leadId,
  customerId = null,
  fromTemperature,
  toTemperature,
  source = 'system',
  changedBy = null,
  changedAt = new Date(),
  metadata = {},
}) => {
  if (!leadId) return null
  if (!fromTemperature || !toTemperature) return null
  if (String(fromTemperature) === String(toTemperature)) return null

  try {
    return await LeadTemperatureTransition.create({
      leadId,
      customerId,
      fromTemperature,
      toTemperature,
      source,
      changedBy,
      changedAt,
      metadata,
    })
  } catch (err) {
    console.error('[LeadTemperatureTransition] write failed:', err.message)
    return null
  }
}

module.exports = { logLeadTemperatureTransition }
