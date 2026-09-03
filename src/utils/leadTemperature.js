const auditService = require('../services/audit.service')
const { AUDIT_ACTIONS } = require('../config/constants')
const { logLeadTemperatureTransition } = require('../services/leadTemperatureTransition.service')

/**
 * Persist manual lead temperature (sets temperatureManual so AI re-score won't overwrite).
 * @param {import('mongoose').Document} lead - Mongoose Lead document
 * @param {'hot'|'warm'|'cold'} temperature
 * @param {import('mongoose').Types.ObjectId} performedBy
 */
const setLeadTemperatureManual = async (lead, temperature, performedBy) => {
  const previous = lead.leadScoring?.temperature || 'cold'
  if (!lead.leadScoring) lead.leadScoring = {}
  lead.leadScoring.temperature = temperature
  lead.leadScoring.temperatureManual = true
  await lead.save()

  await logLeadTemperatureTransition({
    leadId: lead._id,
    customerId: lead.customerId,
    fromTemperature: previous,
    toTemperature: lead.leadScoring.temperature,
    source: 'manual_override',
    changedBy: performedBy,
    metadata: { reason: 'manual_temperature_update' },
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_TEMPERATURE_UPDATED,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy,
    metadata: { previous, temperature },
  })

  const jobId = lead.jobId || ''
  return {
    leadId: lead._id,
    jobId,
    projectId: jobId,
    temperature: lead.leadScoring.temperature,
    temperatureManual: true,
  }
}

module.exports = { setLeadTemperatureManual }
