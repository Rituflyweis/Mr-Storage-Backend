const { PLANT_LIFECYCLE_STAGES } = require('../config/constants')

const validatePlantLifecycleTransition = (currentStatus, nextStatus) => {
  if (!PLANT_LIFECYCLE_STAGES.includes(nextStatus)) {
    return { error: `Invalid lifecycle status. Use one of: ${PLANT_LIFECYCLE_STAGES.join(', ')}` }
  }

  const currentIdx = PLANT_LIFECYCLE_STAGES.indexOf(currentStatus)
  const nextIdx = PLANT_LIFECYCLE_STAGES.indexOf(nextStatus)

  if (currentIdx >= 0 && nextIdx <= currentIdx) {
    return { error: 'Lifecycle can only move forward within plant stages' }
  }

  return null
}

module.exports = {
  PLANT_LIFECYCLE_STAGES,
  validatePlantLifecycleTransition,
}
