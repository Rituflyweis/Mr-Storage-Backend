const {
  PLANT_LIFECYCLE_STAGES,
  LEAD_TEMPERATURES,
} = require('../config/constants')
const { validatePlantLifecycleTransition } = require('./plantLifecycle')
const ProjectStepDetail = require('../models/ProjectStepDetail')

const PLANT_STAGE_LABELS = {
  released_to_plant: 'Released to Plant',
  drawings_received: 'Drawings Received',
  bom_received: 'Bom Received',
  bom_review: 'Bom Review',
  material_check: 'Material Check',
  production_planning: 'Production Planning',
  fabrication_started: 'Fabrication Started',
  quality_inspection: 'Quality Inspection',
  packing_bundling: 'Packing Bundling',
  shipper_prepared: 'Shipper Prepared',
  ready_for_delivery: 'Ready for Delivery',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
}

const formatStageLabel = (stage) => PLANT_STAGE_LABELS[stage] || stage

const historyDateForStage = (history, stage) => {
  const entries = (history || []).filter((h) => h.stage === stage).sort(
    (a, b) => new Date(a.changedAt) - new Date(b.changedAt),
  )
  return entries.length ? entries[entries.length - 1].changedAt : null
}

const resolveCurrentPlantIndex = (lifecycleStatus) => {
  const idx = PLANT_LIFECYCLE_STAGES.indexOf(lifecycleStatus)
  return idx === -1 ? 0 : idx
}

const getNextPlantLifecycleStage = (currentStatus) => {
  const idx = PLANT_LIFECYCLE_STAGES.indexOf(currentStatus)
  if (idx === -1) return PLANT_LIFECYCLE_STAGES[0]
  if (idx >= PLANT_LIFECYCLE_STAGES.length - 1) return null
  return PLANT_LIFECYCLE_STAGES[idx + 1]
}

/**
 * Build plant-only lifecycle stepper (13 steps) for admin + plant project screens.
 */
const buildPlantProjectLifecycle = (lead, { assignedSales = null, stepDetails = [] } = {}) => {
  const history = lead.lifecycleHistory || []
  const currentStatus = lead.lifecycleStatus
  const plantIdx = resolveCurrentPlantIndex(
    PLANT_LIFECYCLE_STAGES.includes(currentStatus) ? currentStatus : PLANT_LIFECYCLE_STAGES[0],
  )
  const detailByKey = new Map((stepDetails || []).map((d) => [d.stepKey, d]))

  const steps = PLANT_LIFECYCLE_STAGES.map((stage, idx) => {
    const detail = detailByKey.get(stage) || null
    const historyDate = historyDateForStage(history, stage)
    let status = 'pending'
    if (idx < plantIdx) status = 'completed'
    else if (idx === plantIdx) status = 'current'

    return {
      stepNumber: idx + 1,
      key: stage,
      label: formatStageLabel(stage),
      status,
      date: historyDate || detail?.startedAt || detail?.completedAt || null,
      startedAt: detail?.startedAt || (status !== 'pending' ? historyDate : null),
      completedAt: detail?.completedAt || (status === 'completed' ? historyDate : null),
      startedBy: detail?.startedBy || '',
      completedBy: detail?.completedBy || '',
      notes: detail?.notes || '',
    }
  })

  const currentKey = PLANT_LIFECYCLE_STAGES[plantIdx]
  const nextKey = getNextPlantLifecycleStage(currentKey)
  const firstPlantDate =
    historyDateForStage(history, 'released_to_plant') || lead.plannedStartDate || null

  const currentDetail = detailByKey.get(currentKey) || {}

  return {
    steps,
    totalSteps: PLANT_LIFECYCLE_STAGES.length,
    currentStepNumber: plantIdx + 1,
    currentStepKey: currentKey,
    currentStepLabel: formatStageLabel(currentKey),
    lifecycleStatus: currentStatus,
    currentStep: {
      key: currentKey,
      label: formatStageLabel(currentKey),
      stepNumber: plantIdx + 1,
      totalSteps: PLANT_LIFECYCLE_STAGES.length,
      plannedStartDate: firstPlantDate,
      targetCompletion: lead.endDate || currentDetail.expectedCompletion || null,
      assignedPlanner: assignedSales?.name || '',
      assignedPlannerId: assignedSales?._id || null,
      priority: lead.leadScoring?.temperature || 'cold',
      priorityLabel: (lead.leadScoring?.temperature || 'cold').replace(/^./, (c) => c.toUpperCase()),
      nextStepKey: nextKey,
      nextStepLabel: nextKey ? formatStageLabel(nextKey) : null,
      notes: currentDetail.notes || '',
      completionPct: currentDetail.completionPct ?? null,
    },
    nextStep: nextKey
      ? { key: nextKey, label: formatStageLabel(nextKey) }
      : null,
  }
}

const upsertStepDetail = async (leadId, stepKey, patch, userId) => {
  const $set = { updatedBy: userId }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) $set[key] = value
  }
  await ProjectStepDetail.findOneAndUpdate(
    { leadId, stepKey },
    { $set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
}

/**
 * Complete current plant step → advance to next stage + auto-fill step detail overlay.
 */
const completePlantLifecycleStep = async (lead, user, { note } = {}) => {
  let current = lead.lifecycleStatus
  if (!PLANT_LIFECYCLE_STAGES.includes(current)) {
    current = PLANT_LIFECYCLE_STAGES[0]
  }

  const next = getNextPlantLifecycleStage(current)
  if (!next) {
    return { error: 'Project is already at the final plant lifecycle stage' }
  }

  const transitionError = validatePlantLifecycleTransition(current, next)
  if (transitionError) return transitionError

  const now = new Date()
  const userName = user?.name || user?.email || 'Staff'

  lead.lifecycleStatus = next
  lead.lifecycleHistory.push({
    stage: next,
    changedAt: now,
    changedBy: user?._id || null,
  })

  if (!lead.plannedStartDate && next === PLANT_LIFECYCLE_STAGES[0]) {
    lead.plannedStartDate = now
  }

  await lead.save()

  await Promise.all([
    upsertStepDetail(lead._id, current, {
      completedAt: now,
      completedBy: userName,
      notes: note ? String(note).trim() : undefined,
    }, user?._id),
    upsertStepDetail(lead._id, next, {
      startedAt: now,
      startedBy: userName,
    }, user?._id),
  ])

  return { nextStatus: next, previousStatus: current }
}

module.exports = {
  PLANT_STAGE_LABELS,
  buildPlantProjectLifecycle,
  completePlantLifecycleStep,
  getNextPlantLifecycleStage,
  formatStageLabel,
}
