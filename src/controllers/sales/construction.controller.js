const Lead = require('../../models/Lead')
const Task = require('../../models/Task')
const { PLANT_LIFECYCLE_STAGES } = require('../../config/constants')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { businessUnitFields, applyBusinessUnitFilter } = require('../../utils/businessUnit')
const {
  buildConstructionDeliveryCalendar,
  resolveConstructionCalendarLeadIds,
} = require('../../utils/constructionProjectCalendar')
const { CONSTRUCTION_STAGES } = require('../../utils/constructionProjectScope')
const {
  enrichConstructionTaskForCard,
  enrichLifecycleStepForCard,
  lifecycleStepsForActivePhase,
  statsFromConstructionCards,
} = require('../../utils/constructionTaskCard.util')
const { loadProjectPhasesPayload } = require('../../services/projectPhases.service')
const {
  listConstructionTasks,
  TASK_LIST_POPULATE,
} = require('../../services/constructionTasksQuery.service')
const accountProjectSubpages = require('../../services/accountProjectSubpages.service')

const PROJECT_SELECT = 'projectName jobId businessUnit location lifecycleStatus endDate plannedStartDate'

const loadSalesConstructionProject = async (leadId, salesId) => {
  const lead = await Lead.findById(leadId)
    .select('_id assignedSales lifecycleStatus isTerminated isArchived projectName jobId')
    .lean()
  if (!lead) return { status: 404, message: 'Project not found' }
  if (String(lead.assignedSales) !== String(salesId)) {
    return { status: 403, message: 'Access denied' }
  }
  if (lead.isTerminated === true || lead.isArchived === true) {
    return { status: 404, message: 'Project not found' }
  }
  if (!CONSTRUCTION_STAGES.includes(lead.lifecycleStatus)) {
    return { status: 404, message: 'Project is not in construction scope' }
  }
  return { lead }
}

const respondSalesConstructionGuard = (res, guard) => {
  if (guard.status === 403) return forbidden(res, guard.message)
  return notFound(res, guard.message)
}

const mapConstructionTaskCards = (tasks) => tasks.map(enrichConstructionTaskForCard)

exports.getProjectCalendar = asyncHandler(async (req, res) => {
  const now = new Date()
  const m = Number(req.query.month) || now.getMonth() + 1
  const y = Number(req.query.year) || now.getFullYear()
  const { leadId } = req.query

  const leadIds = await resolveConstructionCalendarLeadIds({
    stages: PLANT_LIFECYCLE_STAGES,
    businessUnit: req.query.businessUnit,
    assignedSalesId: req.user._id,
  })

  const payload = await buildConstructionDeliveryCalendar({
    leadIds,
    month: m,
    year: y,
    filterLeadId: leadId,
    businessUnit: req.query.businessUnit,
  })

  return success(res, { ...payload, scope: 'sales_assigned_construction' })
})

exports.getProjects = asyncHandler(async (req, res) => {
  const filter = {
    assignedSales: req.user._id,
    isTerminated: { $ne: true },
    isArchived: { $ne: true },
    lifecycleStatus: { $in: PLANT_LIFECYCLE_STAGES },
  }
  applyBusinessUnitFilter(filter, req.query.businessUnit)

  const leads = await Lead.find(filter)
    .select(PROJECT_SELECT)
    .sort({ projectName: 1 })
    .lean()

  return success(res, {
    projects: leads.map((l) => ({ ...l, ...businessUnitFields(l) })),
    total: leads.length,
    scope: 'sales_assigned_construction',
  })
})

/** Project detail — "Project Construction Task" horizontal cards (read-only). */
exports.getProjectConstructionTasks = asyncHandler(async (req, res) => {
  const guard = await loadSalesConstructionProject(req.params.leadId, req.user._id)
  if (guard.status) return respondSalesConstructionGuard(res, guard)

  const query = { ...req.query, leadId: req.params.leadId }
  const { tasks, total, stats } = await listConstructionTasks(query)
  let constructionTasks = mapConstructionTaskCards(tasks)
  let tasksSource = 'task_records'
  let statsOut = stats
  let totalOut = total

  const phasesPayload = await loadProjectPhasesPayload(req.params.leadId)
  const projectProgress = phasesPayload
    ? {
        overallProgressPct: phasesPayload.progress.overallProgressPct,
        currentStepNumber: phasesPayload.progress.currentStepNumber,
        totalSteps: phasesPayload.progress.totalSteps,
        currentStepLabel: phasesPayload.progress.currentStepLabel,
        phases: phasesPayload.phases,
      }
    : null

  if (!constructionTasks.length && phasesPayload) {
    const stepRows = lifecycleStepsForActivePhase(
      phasesPayload.phases,
      phasesPayload.progress.steps
    )
    constructionTasks = stepRows.map(enrichLifecycleStepForCard)
    tasksSource = 'lifecycle_active_phase'
    statsOut = statsFromConstructionCards(constructionTasks)
    totalOut = constructionTasks.length
  }

  return success(res, {
    project: {
      leadId: guard.lead._id,
      projectName: guard.lead.projectName,
      jobId: guard.lead.jobId,
    },
    constructionTasks,
    total: totalOut,
    stats: statsOut,
    tasksSource,
    projectProgress,
    scope: 'sales_assigned_construction',
  })
})

/** List construction tasks for assigned projects (`leadId` required). */
exports.getConstructionTasks = asyncHandler(async (req, res) => {
  const { leadId } = req.query
  if (!leadId) return badRequest(res, 'leadId is required')

  const guard = await loadSalesConstructionProject(leadId, req.user._id)
  if (guard.status) return respondSalesConstructionGuard(res, guard)

  const { tasks, total, stats } = await listConstructionTasks(req.query)
  const constructionTasks = mapConstructionTaskCards(tasks)

  return success(res, {
    constructionTasks,
    total,
    stats,
    scope: 'sales_assigned_construction',
  })
})

exports.getConstructionTaskById = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.taskId).populate(TASK_LIST_POPULATE).lean()
  if (!task) return notFound(res, 'Task not found')

  const leadId = task.leadId?._id || task.leadId
  const guard = await loadSalesConstructionProject(leadId, req.user._id)
  if (guard.status) return respondSalesConstructionGuard(res, guard)

  return success(res, {
    task: enrichConstructionTaskForCard(task),
    scope: 'sales_assigned_construction',
  })
})

const handleProjectSubpageResult = (res, result) => {
  if (result?.error) {
    if (result.code === 404) return notFound(res, result.error)
    return badRequest(res, result.error)
  }
  return success(res, result)
}

/** Figma delivery detail — latest confirmed delivery (same payload as account/construction). */
exports.getProjectFinalDelivery = asyncHandler(async (req, res) => {
  const guard = await loadSalesConstructionProject(req.params.leadId, req.user._id)
  if (guard.status) return respondSalesConstructionGuard(res, guard)

  const result = await accountProjectSubpages.getProjectFinalDelivery(req.params.leadId)
  return handleProjectSubpageResult(res, result)
})

/** Delivery detail when project id + delivery id are known (read-only). */
exports.getProjectDeliveryDetail = asyncHandler(async (req, res) => {
  const guard = await loadSalesConstructionProject(req.params.leadId, req.user._id)
  if (guard.status) return respondSalesConstructionGuard(res, guard)

  const result = await accountProjectSubpages.getProjectDeliveryDetail(
    req.params.leadId,
    req.params.deliveryId
  )
  return handleProjectSubpageResult(res, result)
})
