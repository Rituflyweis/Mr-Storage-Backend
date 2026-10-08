const Lead = require('../models/Lead')
const Delivery = require('../models/Delivery')
const Task = require('../models/Task')
const ProjectStepDetail = require('../models/ProjectStepDetail')
const { DELIVERY_FULFILLMENT_STATUSES, PLANT_LIFECYCLE_STAGES } = require('../config/constants')
const { businessUnitFields } = require('./businessUnit')

const IN_TRANSIT_ROLLUP_STATUSES = new Set(
  DELIVERY_FULFILLMENT_STATUSES.filter((s) => s !== 'delivered')
)

const CONSTRUCTION_ACTIVE_STAGES = PLANT_LIFECYCLE_STAGES.filter(
  (s) => !['dispatched', 'delivered'].includes(s)
)

const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0)

const pctChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 1000) / 10
}

const resolveDeliveryStatusLabel = (statuses) => {
  if (!statuses.length) return 'On Track'
  if (statuses.some((s) => s === 'delayed')) return 'Delayed'
  if (statuses.some((s) => IN_TRANSIT_ROLLUP_STATUSES.has(s))) return 'In Transit'
  if (statuses.some((s) => s === 'delivered' || s === 'received' || s === 'partial_received')) {
    return 'Delivered'
  }
  return 'On Track'
}

const progressPctForLead = (lead, stepPctByLead, progressByLead) => {
  if (lead.lifecycleStatus === 'delivered') return 100
  const key = String(lead._id)
  const stepPct = stepPctByLead.get(key)?.pct
  if (stepPct != null) return stepPct
  const taskProg = progressByLead.get(key)
  if (taskProg?.total) return Math.round((taskProg.done / taskProg.total) * 100)
  return 0
}

const projectHealthBucket = (lead, deliveriesByLead, now) => {
  if (lead.lifecycleStatus === 'delivered') return 'completed'
  const key = String(lead._id)
  const deliveryStatus = resolveDeliveryStatusLabel(deliveriesByLead.get(key) || [])
  const pastDeadline = lead.endDate && new Date(lead.endDate) < now
  if (deliveryStatus === 'Delayed' || pastDeadline) return 'delayed'
  return 'onTrack'
}

const buildProgressMaps = (tasks, stepDetails, allScopedDeliveries) => {
  const progressByLead = new Map()
  for (const t of tasks) {
    const key = String(t.leadId)
    if (!progressByLead.has(key)) progressByLead.set(key, { done: 0, total: 0 })
    const row = progressByLead.get(key)
    row.total += 1
    if (t.status === 'done') row.done += 1
  }

  const stepPctByLead = new Map()
  for (const s of stepDetails) {
    if (s.completionPct == null) continue
    const key = String(s.leadId)
    const prev = stepPctByLead.get(key)
    if (!prev || new Date(s.updatedAt) > new Date(prev.updatedAt)) {
      stepPctByLead.set(key, { pct: s.completionPct, updatedAt: s.updatedAt })
    }
  }

  const deliveriesByLead = new Map()
  for (const d of allScopedDeliveries) {
    const key = String(d.leadId?._id || d.leadId)
    if (!deliveriesByLead.has(key)) deliveriesByLead.set(key, [])
    deliveriesByLead.get(key).push(d.status)
  }

  return { progressByLead, stepPctByLead, deliveriesByLead }
}

const loadStatsContextForLeadIds = async (leadIds, { todayStart, todayEnd, now = new Date() }) => {
  if (!leadIds.length) {
    return {
      leads: [],
      tasks: [],
      allScopedDeliveries: [],
      stepDetails: [],
      projectsAddedToScopeToday: 0,
      upcomingDeadlineLeads: [],
    }
  }

  const leadFilter = { _id: { $in: leadIds } }
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [leads, projectsAddedToScopeToday, tasks, allScopedDeliveries, stepDetails, upcomingDeadlineLeads] =
    await Promise.all([
      Lead.find(leadFilter)
        .select(
          'projectName jobId businessUnit location lifecycleStatus endDate plannedStartDate lifecycleHistory numberOfBuildings buildingType'
        )
        .lean(),
      Lead.countDocuments({
        ...leadFilter,
        $or: [
          { createdAt: { $gte: todayStart, $lte: todayEnd } },
          {
            lifecycleHistory: {
              $elemMatch: {
                stage: 'released_to_plant',
                changedAt: { $gte: todayStart, $lte: todayEnd },
              },
            },
          },
        ],
      }),
      Task.find({ leadId: { $in: leadIds } }).select('status leadId').lean(),
      Delivery.find({
        leadId: { $in: leadIds },
        status: { $nin: ['draft', 'cancelled'] },
      })
        .select('status leadId')
        .lean(),
      ProjectStepDetail.find({ leadId: { $in: leadIds } })
        .select('leadId completionPct stepKey updatedAt')
        .lean(),
      Lead.find({
        ...leadFilter,
        endDate: { $gte: now, $lte: thirtyDaysLater },
      })
        .select('projectName jobId endDate location')
        .sort({ endDate: 1 })
        .limit(10)
        .lean(),
    ])

  return {
    leads,
    tasks,
    allScopedDeliveries,
    stepDetails,
    projectsAddedToScopeToday,
    upcomingDeadlineLeads,
  }
}

const computeProjectStats = (context, now = new Date()) => {
  const { leads, tasks, allScopedDeliveries, stepDetails, projectsAddedToScopeToday, upcomingDeadlineLeads } =
    context

  const { progressByLead, stepPctByLead, deliveriesByLead } = buildProgressMaps(
    tasks,
    stepDetails,
    allScopedDeliveries
  )

  const totalIncludingCompleted = leads.length
  const activeLeads = leads.filter((l) => l.lifecycleStatus !== 'delivered')
  const completedProjects = totalIncludingCompleted - activeLeads.length
  let delayedProjects = 0
  let onTrackProjects = 0
  const progressPcts = []

  for (const lead of leads) {
    progressPcts.push(progressPctForLead(lead, stepPctByLead, progressByLead))
  }
  for (const lead of activeLeads) {
    const bucket = projectHealthBucket(lead, deliveriesByLead, now)
    if (bucket === 'delayed') delayedProjects += 1
    else onTrackProjects += 1
  }

  const totalActive = activeLeads.length
  const totalActiveYesterday = Math.max(0, totalActive - projectsAddedToScopeToday)

  return {
    total: totalActive,
    totalIncludingCompleted,
    onTrack: onTrackProjects,
    delayed: delayedProjects,
    completed: completedProjects,
    onTrackPct: pct(onTrackProjects, totalActive),
    delayedPct: pct(delayedProjects, totalActive),
    completedPct: pct(completedProjects, totalIncludingCompleted),
    completionRate: progressPcts.length
      ? Math.round(progressPcts.reduce((sum, n) => sum + n, 0) / progressPcts.length)
      : 0,
    upcomingDeadlines: upcomingDeadlineLeads.length,
    totalChangePctVsYesterday: pctChange(totalActive, totalActiveYesterday),
    completionRateLabel: 'Average Completion',
  }
}

const buildActiveSites = (context, { now = new Date(), limit = 20 } = {}) => {
  const { leads, tasks, allScopedDeliveries, stepDetails } = context
  const { progressByLead, stepPctByLead, deliveriesByLead } = buildProgressMaps(
    tasks,
    stepDetails,
    allScopedDeliveries
  )

  const rows = leads
    .filter(
      (l) => CONSTRUCTION_ACTIVE_STAGES.includes(l.lifecycleStatus) || l.lifecycleStatus === 'dispatched'
    )
    .map((l) => {
      const key = String(l._id)
      const progressPct = progressPctForLead(l, stepPctByLead, progressByLead)
      const deliveryStatus = resolveDeliveryStatusLabel(deliveriesByLead.get(key) || [])
      const deadline = l.endDate || null
      const isDelayed =
        deliveryStatus === 'Delayed' ||
        (deadline && new Date(deadline) < now && l.lifecycleStatus !== 'delivered')

      return {
        leadId: l._id,
        projectName: l.projectName || '',
        jobId: l.jobId || '',
        ...businessUnitFields(l),
        site: l.location || '',
        buildingType: l.buildingType || '',
        numberOfBuildings: l.numberOfBuildings ?? 1,
        progressPct,
        deadline,
        deliveryStatus: isDelayed && deliveryStatus !== 'Delayed' ? 'Delayed' : deliveryStatus,
        lifecycleStatus: l.lifecycleStatus,
      }
    })
    .sort((a, b) => String(a.projectName).localeCompare(String(b.projectName)))

  if (limit == null) return rows
  return rows.slice(0, limit)
}

const buildAllProjectsExportRows = (context, now = new Date()) => {
  const { leads, tasks, allScopedDeliveries, stepDetails } = context
  const { progressByLead, stepPctByLead, deliveriesByLead } = buildProgressMaps(
    tasks,
    stepDetails,
    allScopedDeliveries
  )

  return leads
    .map((l) => {
      const key = String(l._id)
      const progressPct = progressPctForLead(l, stepPctByLead, progressByLead)
      const deliveryStatus = resolveDeliveryStatusLabel(deliveriesByLead.get(key) || [])
      const health = projectHealthBucket(l, deliveriesByLead, now)
      return {
        jobId: l.jobId || '',
        projectName: l.projectName || '',
        site: l.location || '',
        lifecycleStatus: l.lifecycleStatus || '',
        progressPct,
        deliveryStatus,
        health: health === 'completed' ? 'Completed' : health === 'delayed' ? 'Delayed' : 'On Track',
        deadline: l.endDate || null,
        businessUnitLabel: businessUnitFields(l).businessUnitLabel,
      }
    })
    .sort((a, b) => String(a.projectName).localeCompare(String(b.projectName)))
}

const loadProjectStatsForMongoFilter = async (mongoFilter, { todayStart, todayEnd, now = new Date() }) => {
  const ids = await Lead.find(mongoFilter).select('_id').lean()
  const leadIds = ids.map((r) => r._id)
  const context = await loadStatsContextForLeadIds(leadIds, { todayStart, todayEnd, now })
  return {
    projectStats: computeProjectStats(context, now),
    context,
  }
}

module.exports = {
  CONSTRUCTION_ACTIVE_STAGES,
  loadStatsContextForLeadIds,
  computeProjectStats,
  buildActiveSites,
  buildAllProjectsExportRows,
  loadProjectStatsForMongoFilter,
}
