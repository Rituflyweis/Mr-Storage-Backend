const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const MaterialRequest = require('../../models/MaterialRequest')
const FreightBid = require('../../models/FreightBid')
const AuditLog = require('../../models/AuditLog')
const ShipperRequest = require('../../models/ShipperRequest')
const Building = require('../../models/Building')
const ProjectStepDetail = require('../../models/ProjectStepDetail')
const DailyProductionLog = require('../../models/DailyProductionLog')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { DELIVERY_FULFILLMENT_STATUSES, PLANT_LIFECYCLE_STAGES } = require('../../config/constants')

const IN_TRANSIT_ROLLUP_STATUSES = new Set(
  DELIVERY_FULFILLMENT_STATUSES.filter((s) => s !== 'delivered')
)
const OUT_FOR_DELIVERY_STATUSES = new Set(['scheduled', 'confirmed', 'dispatched_to_site'])

const CONSTRUCTION_STAGES = [...PLANT_LIFECYCLE_STAGES]
const CONSTRUCTION_ACTIVE_STAGES = PLANT_LIFECYCLE_STAGES.filter(
  (s) => !['dispatched', 'delivered'].includes(s)
)

/** Figma overall timeline buckets mapped from plant lifecycle stages. */
const OVERALL_TIMELINE_PHASES = [
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

const startOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

const endOfDay = (d = new Date()) => {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0)

const pctChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 1000) / 10
}

const historyDateForStage = (history, stage) => {
  const entries = (history || [])
    .filter((h) => h.stage === stage)
    .sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
  return entries.length ? entries[entries.length - 1].changedAt : null
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

const parseDashboardFilters = (query) => {
  const {
    projectId,
    leadId,
    buildingId,
    status,
    lifecycleStatus,
    fromDate,
    toDate,
    dateFrom,
    dateTo,
  } = query

  const projectFilterId = projectId || leadId || null
  const statusFilter = status || lifecycleStatus || null
  const rangeStart = fromDate || dateFrom || null
  const rangeEnd = toDate || dateTo || null

  if (projectFilterId && !/^[a-fA-F0-9]{24}$/.test(String(projectFilterId))) {
    return { error: 'Invalid projectId' }
  }
  if (buildingId && !/^[a-fA-F0-9]{24}$/.test(String(buildingId))) {
    return { error: 'Invalid buildingId' }
  }
  if (rangeStart && Number.isNaN(Date.parse(rangeStart))) {
    return { error: 'Invalid fromDate' }
  }
  if (rangeEnd && Number.isNaN(Date.parse(rangeEnd))) {
    return { error: 'Invalid toDate' }
  }

  return {
    projectId: projectFilterId,
    buildingId: buildingId || null,
    status: statusFilter,
    fromDate: rangeStart ? new Date(rangeStart) : null,
    toDate: rangeEnd ? new Date(rangeEnd) : null,
  }
}

const getConstructionLeadIds = async (filters) => {
  const filter = {
    lifecycleStatus: { $in: CONSTRUCTION_STAGES },
    isTerminated: { $ne: true },
  }
  if (filters.projectId) filter._id = filters.projectId
  if (filters.status) filter.lifecycleStatus = filters.status

  if (filters.buildingId) {
    const building = await Building.findById(filters.buildingId).select('leadId').lean()
    if (!building?.leadId) return []
    const buildingLeadId = String(building.leadId)
    if (filters.projectId && String(filters.projectId) !== buildingLeadId) return []
    filter._id = building.leadId
  }

  const leads = await Lead.find(filter).select('_id').lean()
  return leads.map((l) => l._id)
}

const buildOverallTimeline = (leads) => {
  const now = Date.now()
  return OVERALL_TIMELINE_PHASES.map((phase) => {
    let earliestDate = null
    let anyReached = false
    let anyCurrent = false
    let allPast = leads.length > 0

    for (const lead of leads) {
      const idx = PLANT_LIFECYCLE_STAGES.indexOf(lead.lifecycleStatus)
      const firstStageIdx = PLANT_LIFECYCLE_STAGES.indexOf(phase.stages[0])
      const lastStageIdx = PLANT_LIFECYCLE_STAGES.indexOf(phase.stages[phase.stages.length - 1])

      const reached = idx >= firstStageIdx
      const past = idx > lastStageIdx
      const current = idx >= firstStageIdx && idx <= lastStageIdx

      if (reached) anyReached = true
      if (current) anyCurrent = true
      if (!past) allPast = false

      for (const stage of phase.stages) {
        const d = historyDateForStage(lead.lifecycleHistory, stage)
        if (d && (!earliestDate || new Date(d) < new Date(earliestDate))) {
          earliestDate = d
        }
      }
    }

    let status = 'Upcoming'
    if (!leads.length) status = 'Upcoming'
    else if (allPast) status = 'Completed'
    else if (anyCurrent || (anyReached && !allPast)) status = 'Inprogress'
    else status = 'Upcoming'

    // If date is in the past and phase still in progress, keep Inprogress; if completed use date.
    if (status === 'Upcoming' && earliestDate && new Date(earliestDate).getTime() > now) {
      status = 'Upcoming'
    }

    return {
      key: phase.key,
      label: phase.label,
      date: earliestDate,
      status,
    }
  })
}

const formatActivityMessage = (log) => {
  const meta = log.metadata || {}
  if (meta.message) return String(meta.message)
  if (meta.title) return String(meta.title)
  const action = String(log.action || '').replace(/_/g, ' ')
  const project = meta.projectName || meta.jobId || ''
  return project ? `${action} — ${project}` : action
}

// GET /dashboard — Construction Panel home screen
exports.getDashboard = asyncHandler(async (req, res) => {
  const parsed = parseDashboardFilters(req.query)
  if (parsed.error) return badRequest(res, parsed.error)

  const leadIds = await getConstructionLeadIds(parsed)
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  // Delivery date window: explicit filter, else "today" for overview + freight (Figma).
  const deliveryRangeStart = parsed.fromDate ? startOfDay(parsed.fromDate) : todayStart
  const deliveryRangeEnd = parsed.toDate ? endOfDay(parsed.toDate) : todayEnd

  if (!leadIds.length) {
    return success(res, {
      filtersApplied: {
        projectId: parsed.projectId,
        buildingId: parsed.buildingId,
        status: parsed.status,
        fromDate: parsed.fromDate,
        toDate: parsed.toDate,
      },
      projectStats: {
        total: 0,
        onTrack: 0,
        delayed: 0,
        completed: 0,
        onTrackPct: 0,
        delayedPct: 0,
        completedPct: 0,
        completionRate: 0,
        upcomingDeadlines: 0,
        totalChangePctVsYesterday: 0,
        completionRateLabel: 'Average Completion',
      },
      deliveryOverview: {
        scope: parsed.fromDate || parsed.toDate ? 'range' : 'today',
        fromDate: deliveryRangeStart,
        toDate: deliveryRangeEnd,
        delivered: 0,
        inTransit: 0,
        outForDelivery: 0,
        delayed: 0,
        total: 0,
        deliveredPct: 0,
        inTransitPct: 0,
        outForDeliveryPct: 0,
        delayedPct: 0,
      },
      materialRequestOverview: {
        pendingApproval: 0,
        approved: 0,
        rejected: 0,
        urgent: 0,
        total: 0,
        approvedPct: 0,
        pendingApprovalPct: 0,
        rejectedPct: 0,
      },
      taskOverview: { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 },
      activeSites: [],
      upcomingDeadlines: [],
      projectTimelineOverall: buildOverallTimeline([]),
      freightCarriers: {
        rows: [],
        totals: { totalLoadsToday: 0, onTime: 0, onTimePct: 0, delayed: 0, delayedPct: 0 },
      },
      recentActivity: [],
      recentDeliveries: [],
    })
  }

  const leadFilter = { _id: { $in: leadIds } }

  const [
    leads,
    totalProjects,
    completedProjects,
    delayedProjects,
    totalProjectsAsOfYesterday,
    deliveriesInRange,
    allScopedDeliveries,
    tasks,
    upcomingDeadlineLeads,
    materialRequests,
    shipperRecent,
    auditLogs,
    stepDetails,
    productionLog,
  ] = await Promise.all([
    Lead.find(leadFilter)
      .select('projectName jobId location lifecycleStatus endDate plannedStartDate lifecycleHistory numberOfBuildings buildingType')
      .lean(),
    Lead.countDocuments(leadFilter),
    Lead.countDocuments({ ...leadFilter, lifecycleStatus: 'delivered' }),
    Lead.countDocuments({
      ...leadFilter,
      endDate: { $lt: now },
      lifecycleStatus: { $nin: ['delivered'] },
    }),
    Lead.countDocuments({
      ...leadFilter,
      $or: [
        { createdAt: { $lt: todayStart } },
        {
          lifecycleHistory: {
            $elemMatch: {
              stage: { $in: CONSTRUCTION_STAGES },
              changedAt: { $lt: todayStart },
            },
          },
        },
      ],
    }),
    Delivery.find({
      leadId: { $in: leadIds },
      status: { $nin: ['draft', 'cancelled'] },
      deliveryDate: { $gte: deliveryRangeStart, $lte: deliveryRangeEnd },
    })
      .select('status deliveryDate leadId selectedCarrierBidId deliveryNumber')
      .populate('leadId', 'projectName jobId location')
      .lean(),
    Delivery.find({
      leadId: { $in: leadIds },
      status: { $nin: ['draft', 'cancelled'] },
    })
      .select('status deliveryDate leadId deliveryNumber selectedCarrierBidId')
      .populate('leadId', 'projectName jobId location')
      .lean(),
    Task.find({ leadId: { $in: leadIds } }).select('status priority dueDate leadId').lean(),
    Lead.find({
      ...leadFilter,
      endDate: { $gte: now, $lte: thirtyDaysLater },
    })
      .select('projectName jobId endDate location')
      .sort({ endDate: 1 })
      .limit(10)
      .lean(),
    MaterialRequest.find({ leadId: { $in: leadIds } })
      .select('status priority')
      .lean(),
    ShipperRequest.find({ leadId: { $in: leadIds }, submittedAt: { $ne: null } })
      .sort({ submittedAt: -1 })
      .limit(8)
      .populate('leadId', 'projectName jobId')
      .populate('vendorId', 'vendorName')
      .lean(),
    AuditLog.find({
      leadId: { $in: leadIds },
      createdAt: { $gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('performedBy', 'name')
      .lean(),
    ProjectStepDetail.find({ leadId: { $in: leadIds } })
      .select('leadId completionPct stepKey updatedAt')
      .lean(),
    DailyProductionLog.findOne({ date: todayStart }).lean(),
  ])

  const onTrack = Math.max(0, totalProjects - delayedProjects - completedProjects)
  const totalChangePctVsYesterday = pctChange(totalProjects, totalProjectsAsOfYesterday)

  const projectStats = {
    total: totalProjects,
    onTrack,
    delayed: delayedProjects,
    completed: completedProjects,
    onTrackPct: pct(onTrack, totalProjects),
    delayedPct: pct(delayedProjects, totalProjects),
    completedPct: pct(completedProjects, totalProjects),
    completionRate: totalProjects ? Math.round((completedProjects / totalProjects) * 100) : 0,
    upcomingDeadlines: upcomingDeadlineLeads.length,
    totalChangePctVsYesterday,
    completionRateLabel: 'Average Completion',
  }

  const deliveryOverview = {
    scope: parsed.fromDate || parsed.toDate ? 'range' : 'today',
    fromDate: deliveryRangeStart,
    toDate: deliveryRangeEnd,
    delivered: deliveriesInRange.filter((d) => d.status === 'delivered' || d.status === 'received').length,
    inTransit: deliveriesInRange.filter((d) => IN_TRANSIT_ROLLUP_STATUSES.has(d.status)).length,
    outForDelivery: deliveriesInRange.filter((d) => OUT_FOR_DELIVERY_STATUSES.has(d.status)).length,
    delayed: deliveriesInRange.filter((d) => d.status === 'delayed').length,
    total: deliveriesInRange.length,
  }
  deliveryOverview.deliveredPct = pct(deliveryOverview.delivered, deliveryOverview.total)
  deliveryOverview.inTransitPct = pct(deliveryOverview.inTransit, deliveryOverview.total)
  deliveryOverview.outForDeliveryPct = pct(deliveryOverview.outForDelivery, deliveryOverview.total)
  deliveryOverview.delayedPct = pct(deliveryOverview.delayed, deliveryOverview.total)

  const mrPending = materialRequests.filter((m) => m.status === 'pending').length
  const mrApproved = materialRequests.filter((m) => m.status === 'approved').length
  const mrRejected = materialRequests.filter((m) => m.status === 'rejected').length
  const mrUrgent = materialRequests.filter(
    (m) => m.priority === 'critical' || m.priority === 'high'
  ).length
  const mrTotal = materialRequests.length
  const materialRequestOverview = {
    pendingApproval: mrPending,
    approved: mrApproved,
    rejected: mrRejected,
    urgent: mrUrgent,
    total: mrTotal,
    approvedPct: pct(mrApproved, mrTotal),
    pendingApprovalPct: pct(mrPending, mrTotal),
    rejectedPct: pct(mrRejected, mrTotal),
  }

  const taskOverview = {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === 'todo').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
    overdue: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length,
  }

  // Progress %: prefer ProjectStepDetail.completionPct (latest), else task completion.
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

  const activeSites = leads
    .filter((l) => CONSTRUCTION_ACTIVE_STAGES.includes(l.lifecycleStatus) || l.lifecycleStatus === 'dispatched')
    .map((l) => {
      const key = String(l._id)
      const taskProg = progressByLead.get(key)
      const stepPct = stepPctByLead.get(key)?.pct
      const progressPct =
        stepPct != null
          ? stepPct
          : taskProg?.total
            ? Math.round((taskProg.done / taskProg.total) * 100)
            : 0
      const deliveryStatus = resolveDeliveryStatusLabel(deliveriesByLead.get(key) || [])
      const deadline = l.endDate || null
      const isDelayed =
        deliveryStatus === 'Delayed' ||
        (deadline && new Date(deadline) < now && l.lifecycleStatus !== 'delivered')

      return {
        leadId: l._id,
        projectName: l.projectName || '',
        jobId: l.jobId || '',
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
    .slice(0, 20)

  const upcomingDeadlines = upcomingDeadlineLeads.map((l) => ({
    leadId: l._id,
    projectName: l.projectName,
    jobId: l.jobId,
    location: l.location,
    site: l.location || '',
    endDate: l.endDate,
    daysLeft: Math.ceil((new Date(l.endDate) - now) / (1000 * 60 * 60 * 24)),
  }))

  const projectTimelineOverall = buildOverallTimeline(leads)

  // Freight carriers — loads in delivery range (default today), on-time vs delayed.
  const bidIds = deliveriesInRange.map((d) => d.selectedCarrierBidId).filter(Boolean)
  const bids = bidIds.length
    ? await FreightBid.find({ _id: { $in: bidIds } })
        .select('carrierId')
        .populate('carrierId', 'carrierName')
        .lean()
    : []
  const bidCarrierMap = new Map(bids.map((b) => [String(b._id), b.carrierId]))
  const carrierLoadMap = new Map()
  for (const d of deliveriesInRange) {
    const carrier = d.selectedCarrierBidId
      ? bidCarrierMap.get(String(d.selectedCarrierBidId))
      : null
    if (!carrier) continue
    const key = String(carrier._id)
    if (!carrierLoadMap.has(key)) {
      carrierLoadMap.set(key, {
        carrierId: carrier._id,
        carrierName: carrier.carrierName || '',
        loadsToday: 0,
        onTime: 0,
        delayed: 0,
      })
    }
    const entry = carrierLoadMap.get(key)
    entry.loadsToday += 1
    if (d.status === 'delayed') entry.delayed += 1
    else entry.onTime += 1
  }
  const freightRows = [...carrierLoadMap.values()].map((c) => ({
    ...c,
    priority: c.delayed > 0 ? 'Delayed' : 'On Time',
  }))
  const totalLoadsToday = freightRows.reduce((s, r) => s + r.loadsToday, 0)
  const freightOnTime = freightRows.reduce((s, r) => s + r.onTime, 0)
  const freightDelayed = freightRows.reduce((s, r) => s + r.delayed, 0)
  const freightCarriers = {
    rows: freightRows,
    totals: {
      totalLoadsToday,
      onTime: freightOnTime,
      onTimePct: pct(freightOnTime, totalLoadsToday),
      delayed: freightDelayed,
      delayedPct: pct(freightDelayed, totalLoadsToday),
    },
  }

  // Recent activity — merge audit + shipper submissions + production log note.
  const recentActivity = []
  for (const log of auditLogs) {
    recentActivity.push({
      type: 'audit',
      action: log.action,
      message: formatActivityMessage(log),
      occurredAt: log.createdAt,
      leadId: log.leadId || null,
      actorName: log.performedBy?.name || null,
      refId: log.entityId || log._id,
    })
  }
  for (const r of shipperRecent) {
    recentActivity.push({
      type: 'shipper_file',
      action: 'shipper_file_submitted',
      message: `New shipper file received for ${r.leadId?.projectName || 'project'}${
        r.vendorId?.vendorName ? ` (${r.vendorId.vendorName})` : ''
      }`,
      occurredAt: r.submittedAt,
      leadId: r.leadId?._id || r.leadId,
      actorName: r.vendorId?.vendorName || null,
      refId: r._id,
    })
  }
  if (productionLog?.utilizationPct != null) {
    recentActivity.push({
      type: 'production',
      action: 'production_target',
      message: `Production target for today is ${productionLog.utilizationPct}%`,
      occurredAt: productionLog.updatedAt || productionLog.date || todayStart,
      leadId: null,
      actorName: null,
      refId: productionLog._id,
    })
  }
  recentActivity.sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0))

  const recentDeliveries = allScopedDeliveries
    .filter((d) => IN_TRANSIT_ROLLUP_STATUSES.has(d.status) || d.status === 'delivered')
    .sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))
    .slice(0, 5)
    .map((d) => ({
      deliveryId: d._id,
      deliveryNumber: d.deliveryNumber || '',
      status: d.status,
      deliveryDate: d.deliveryDate,
      project: {
        leadId: d.leadId?._id,
        projectName: d.leadId?.projectName,
        jobId: d.leadId?.jobId,
        location: d.leadId?.location,
      },
    }))

  return success(res, {
    filtersApplied: {
      projectId: parsed.projectId,
      buildingId: parsed.buildingId,
      status: parsed.status,
      fromDate: parsed.fromDate,
      toDate: parsed.toDate,
    },
    projectStats,
    deliveryOverview,
    materialRequestOverview,
    taskOverview,
    activeSites,
    upcomingDeadlines,
    projectTimelineOverall,
    freightCarriers,
    recentActivity: recentActivity.slice(0, 15),
    recentDeliveries,
  })
})

/** Filter dropdown helpers for the dashboard controls. */
exports.getDashboardFilters = asyncHandler(async (req, res) => {
  const leadIds = await getConstructionLeadIds({})
  if (!leadIds.length) {
    return success(res, {
      projects: [],
      buildings: [],
      statuses: CONSTRUCTION_STAGES,
    })
  }

  const [projects, buildings] = await Promise.all([
    Lead.find({ _id: { $in: leadIds } })
      .select('projectName jobId lifecycleStatus location')
      .sort({ projectName: 1 })
      .lean(),
    Building.find({ leadId: { $in: leadIds } })
      .select('leadId buildingNumber status')
      .lean(),
  ])

  return success(res, {
    projects: projects.map((p) => ({
      _id: p._id,
      projectName: p.projectName || '',
      jobId: p.jobId || '',
      lifecycleStatus: p.lifecycleStatus,
      location: p.location || '',
    })),
    buildings: buildings.map((b) => ({
      _id: b._id,
      leadId: b.leadId,
      buildingNumber: b.buildingNumber,
      name: `Building ${b.buildingNumber}`,
      status: b.status,
    })),
    statuses: CONSTRUCTION_STAGES,
  })
})
