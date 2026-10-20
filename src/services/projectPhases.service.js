const Lead = require('../models/Lead')
const ProjectStepDetail = require('../models/ProjectStepDetail')
const {
  computeProjectSteps,
  buildPhasesFromSteps,
} = require('../utils/computeProjectSteps')

const loadProjectPhasesPayload = async (leadId) => {
  const lead = await Lead.findById(leadId)
    .select('projectName jobId endDate plannedStartDate lifecycleStatus lifecycleHistory')
    .lean()
  if (!lead) return null

  const stepDetails = await ProjectStepDetail.find({ leadId: lead._id }).lean()
  const progress = computeProjectSteps(lead, stepDetails)
  const phases = buildPhasesFromSteps(lead, progress.steps)

  return { lead, progress, phases, stepDetails }
}

module.exports = {
  loadProjectPhasesPayload,
}
