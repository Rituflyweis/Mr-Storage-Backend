const { LIFECYCLE_STAGES, INVOICE_CREATE_MIN_LIFECYCLE_STAGE } = require('../config/constants')

/**
 * Set lifecycle stage on a lead document. Skips history when stage is unchanged.
 * @returns {boolean} true if the stage was updated
 */
const setLeadLifecycleStage = (lead, stage, changedBy = null) => {
  if (!stage || !LIFECYCLE_STAGES.includes(stage)) return false
  if (lead.lifecycleStatus === stage) return false

  lead.lifecycleStatus = stage
  lead.lifecycleHistory.push({
    stage,
    changedAt: new Date(),
    changedBy,
  })
  return true
}

const isLifecycleAtLeast = (currentStage, minimumStage = INVOICE_CREATE_MIN_LIFECYCLE_STAGE) => {
  const minIdx = LIFECYCLE_STAGES.indexOf(minimumStage)
  const currentIdx = LIFECYCLE_STAGES.indexOf(currentStage)
  if (minIdx === -1 || currentIdx === -1) return false
  return currentIdx >= minIdx
}

module.exports = { setLeadLifecycleStage, isLifecycleAtLeast }
