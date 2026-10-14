const { LIFECYCLE_STAGES } = require('../config/constants')

const STAGE_LABELS = {
  initial_contact: 'Initial Contact',
  requirements_gathered: 'Requirements Gathered',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  deal_closed: 'Deal Closed',
  payment_done: 'Payment Done',
  converted_to_po: 'Converted to PO',
  sent_to_admin: 'Sent to Admin',
  released_to_plant: 'Released to Plant',
  drawings_received: 'Drawings Received',
  bom_received: 'BOM Received',
  bom_review: 'BOM Review',
  material_check: 'Material Check',
  production_planning: 'Production Planning',
  fabrication_started: 'Fabrication Started',
  quality_inspection: 'Quality Inspection',
  packing_bundling: 'Packing & Bundling',
  shipper_prepared: 'Shipper Prepared',
  ready_for_delivery: 'Ready for Delivery',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
}

const PROJECT_STEP_DEFS = LIFECYCLE_STAGES.map((stage) => ({
  key: stage,
  label: STAGE_LABELS[stage] || stage,
  stages: [stage],
}))

/** Figma overall timeline buckets mapped from lifecycle stages. */
const CONSTRUCTION_TIMELINE_PHASES = [
  {
    key: 'planning',
    label: 'Planning',
    stages: ['released_to_plant', 'drawings_received'],
  },
  {
    key: 'design',
    label: 'Design',
    stages: ['bom_received', 'bom_review', 'material_check'],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    stages: ['production_planning', 'shipper_prepared'],
  },
  {
    key: 'execution',
    label: 'Execution',
    stages: ['fabrication_started', 'quality_inspection', 'packing_bundling', 'ready_for_delivery'],
  },
  {
    key: 'handover',
    label: 'Handover',
    stages: ['dispatched', 'delivered'],
  },
]

const computeProjectSteps = (lead, stepDetails = []) => {
  const currentStage = lead.lifecycleStatus
  const history = lead.lifecycleHistory || []
  const foundIdx = PROJECT_STEP_DEFS.findIndex((b) => b.stages.includes(currentStage))
  const currentIdx = foundIdx === -1 ? 0 : foundIdx
  const detailByKey = new Map(stepDetails.map((d) => [d.stepKey, d]))

  const steps = PROJECT_STEP_DEFS.map((bucket, idx) => {
    const entries = history
      .filter((h) => bucket.stages.includes(h.stage))
      .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
    const detail = detailByKey.get(bucket.key) || null

    let status
    let date
    if (idx < currentIdx) {
      status = 'completed'
      date = entries.length ? entries[entries.length - 1].changedAt : null
    } else if (idx === currentIdx) {
      status = 'in_progress'
      date = entries.length ? entries[0].changedAt : null
    } else {
      status = 'pending'
      date = null
    }

    return {
      key: bucket.key,
      stepKey: bucket.key,
      label: bucket.label,
      status,
      date,
      startedBy: detail?.startedBy || '',
      startedAt: detail?.startedAt || (status !== 'pending' ? date : null),
      completedBy: detail?.completedBy || '',
      completedAt: detail?.completedAt || (status === 'completed' ? date : null),
      currentStage: detail?.currentStage || '',
      completionPct:
        detail?.completionPct ?? (status === 'completed' ? 100 : status === 'pending' ? 0 : null),
      percentComplete:
        detail?.completionPct ?? (status === 'completed' ? 100 : status === 'pending' ? 0 : null),
      expectedCompletion: detail?.expectedCompletion || null,
      endDate: detail?.completedAt || detail?.expectedCompletion || null,
      notes: detail?.notes || '',
      attachments: detail?.attachments || [],
    }
  })

  const currentStepNumber = currentIdx + 1
  const totalSteps = PROJECT_STEP_DEFS.length

  return {
    steps,
    currentStepNumber,
    totalSteps,
    currentStepLabel: PROJECT_STEP_DEFS[currentIdx]?.label || '',
    overallProgressPct: totalSteps ? Math.round((currentStepNumber / totalSteps) * 100) : 0,
  }
}

const buildPhasesFromSteps = (lead, steps = []) => {
  const stepByKey = new Map(steps.map((s) => [s.key, s]))
  const currentStage = lead.lifecycleStatus

  return CONSTRUCTION_TIMELINE_PHASES.map((phase) => {
    const phaseSteps = phase.stages.map((k) => stepByKey.get(k)).filter(Boolean)
    const total = phaseSteps.length
    const completed = phaseSteps.filter((s) => s.status === 'completed').length
    const inProgress = phaseSteps.some((s) => s.status === 'in_progress')
    const percentComplete = total ? Math.round((completed / total) * 100) : 0

    let status = 'Upcoming'
    if (completed === total && total > 0) status = 'Completed'
    else if (inProgress || completed > 0) status = 'Inprogress'
    else if (phase.stages.includes(currentStage)) status = 'Inprogress'

    const dates = phaseSteps
      .map((s) => s.completedAt || s.startedAt || s.date)
      .filter(Boolean)
      .map((d) => new Date(d))
    const phaseDate = dates.length ? new Date(Math.min(...dates)).toISOString() : null

    return {
      key: phase.key,
      label: phase.label,
      status,
      date: phaseDate,
      percentComplete,
      stepsCompleted: completed,
      stepsTotal: total,
      stageKeys: phase.stages,
    }
  })
}

module.exports = {
  STAGE_LABELS,
  PROJECT_STEP_DEFS,
  CONSTRUCTION_TIMELINE_PHASES,
  computeProjectSteps,
  buildPhasesFromSteps,
}
