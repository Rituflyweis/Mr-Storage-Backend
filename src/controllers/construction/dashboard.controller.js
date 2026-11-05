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
const {
  BUSINESS_UNITS,
  getBusinessUnitLabel,
  buildBusinessUnitFilter,
  businessUnitFields,
} = require('../../utils/businessUnit')
const { getConstructionLeadIds } = require('../../utils/constructionProjectScope')
const {
  loadStatsContextForLeadIds,
  computeProjectStats,
  buildActiveSites,
  buildAllProjectsExportRows,
} = require('../../utils/constructionProjectStats')
const { generateConstructionDashboardExcel } = require('../../utils/exportConstructionAdmin')
const {
  loadUpcomingConstructionTasks,
  mapUpcomingScheduleRows,
  buildOverallTimelineFromLeads,
} = require('../../utils/constructionTimeline.util')
const { buildDashboardScopeFilter } = require('../../utils/constructionProjectScope')

const IN_TRANSIT_ROLLUP_STATUSES = new Set(
  DELIVERY_FULFILLMENT_STATUSES.filter((s) => s !== 'delivered')
)
const OUT_FOR_DELIVERY_STATUSES = new Set(['scheduled', 'confirmed', 'dispatched_to_site'])

const CONSTRUCTION_STAGES = [...PLANT_LIFECYCLE_STAGES]

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

  const businessUnitFilter = buildBusinessUnitFilter(query.businessUnit)

  return {
    projectId: projectFilterId,
    buildingId: buildingId || null,
    status: statusFilter,
    businessUnit: businessUnitFilter ? businessUnitFilter.businessUnit : undefined,
    fromDate: rangeStart ? new Date(rangeStart) : null,
    toDate: rangeEnd ? new Date(rangeEnd) : null,
  }
}

/** Delivery/freight window: explicit from/to → range; otherwise all scoped deliveries (not calendar today). */
const resolveDeliveryScopeForDashboard = (parsed, now = new Date()) => {
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const hasExplicitRange = Boolean(parsed.fromDate || parsed.toDate)
  if (!hasExplicitRange) {
    return { scope: 'all', fromDate: null, toDate: null, deliveryDateFilter: null }
  }
  const fromDate = parsed.fromDate ? startOfDay(parsed.fromDate) : todayStart
  const toDate = parsed.toDate ? endOfDay(parsed.toDate) : todayEnd
  return {
    scope: 'range',
    fromDate,
    toDate,
    deliveryDateFilter: { deliveryDate: { $gte: fromDate, $lte: toDate } },
  }
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
  const parsedTaskDays = Math.min(Math.max(parseInt(req.query.taskDeadlineDays, 10) || 30, 1), 90)
  const parsedTaskLimit = Math.min(Math.max(parseInt(req.query.taskLimit, 10) || 10, 1), 50)
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const deliveryScope = resolveDeliveryScopeForDashboard(parsed, now)

  if (!leadIds.length) {
    return success(res, {
      filtersApplied: {
        projectId: parsed.projectId,
        buildingId: parsed.buildingId,
        status: parsed.status,
        businessUnit: parsed.businessUnit ?? null,
        fromDate: parsed.fromDate,
        toDate: parsed.toDate,
      },
      projectStats: {
        total: 0,
        totalIncludingCompleted: 0,
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
        scope: deliveryScope.scope,
        fromDate: deliveryScope.fromDate,
        toDate: deliveryScope.toDate,
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
      upcomingConstructionTasks: [],
      upcomingSchedule: [],
      projectTimelineOverall: buildOverallTimelineFromLeads([]),
      freightCarriers: {
        rows: [],
        totals: { totalLoadsToday: 0, onTime: 0, onTimePct: 0, delayed: 0, delayedPct: 0 },
      },
      recentActivity: [],
      recentDeliveries: [],
    })
  }

  const leadFilter = { _id: { $in: leadIds } }

  const scopeFilter = await buildDashboardScopeFilter(parsed)

  const [
    leads,
    projectsAddedToScopeToday,
    deliveriesInRange,
    allScopedDeliveries,
    tasks,
    upcomingDeadlineLeads,
    upcomingConstruction,
    materialRequests,
    shipperRecent,
    auditLogs,
    stepDetails,
    productionLog,
  ] = await Promise.all([
    Lead.find(leadFilter)
      .select('projectName jobId businessUnit location lifecycleStatus endDate plannedStartDate lifecycleHistory numberOfBuildings buildingType')
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
    Delivery.find({
      leadId: { $in: leadIds },
      status: { $nin: ['draft', 'cancelled'] },
      ...(deliveryScope.deliveryDateFilter || {}),
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
    loadUpcomingConstructionTasks({
      projectId: parsed.projectId || null,
      leadFilter: scopeFilter && !parsed.projectId ? scopeFilter : {},
      leadIds: parsed.projectId ? leadIds : null,
      daysAhead: parsedTaskDays,
      limit: parsedTaskLimit,
    }),
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

  const deliveryOverview = {
    scope: deliveryScope.scope,
    fromDate: deliveryScope.fromDate,
    toDate: deliveryScope.toDate,
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

  const statsContext = {
    leads,
    tasks,
    allScopedDeliveries,
    stepDetails,
    projectsAddedToScopeToday,
    upcomingDeadlineLeads,
  }
  const projectStats = computeProjectStats(statsContext, now)
  const activeSites = buildActiveSites(statsContext, { now, limit: 20 })

  const upcomingDeadlines = upcomingDeadlineLeads.map((l) => ({
    leadId: l._id,
    projectName: l.projectName,
    jobId: l.jobId,
    location: l.location,
    site: l.location || '',
    endDate: l.endDate,
    daysLeft: Math.ceil((new Date(l.endDate) - now) / (1000 * 60 * 60 * 24)),
  }))

  const projectTimelineOverall = buildOverallTimelineFromLeads(leads)
  const upcomingConstructionTasks = upcomingConstruction.tasks

  // Freight carriers — loads in delivery scope (all scoped deliveries unless date range set).
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
      businessUnit: parsed.businessUnit ?? null,
      fromDate: parsed.fromDate,
      toDate: parsed.toDate,
    },
    projectStats,
    deliveryOverview,
    materialRequestOverview,
    taskOverview,
    activeSites,
    upcomingDeadlines,
    upcomingConstructionTasks,
    /** Task-based schedule (same as Admin → Construction overview). Falls back to project end dates when empty. */
    upcomingSchedule: upcomingConstructionTasks.length
      ? mapUpcomingScheduleRows(upcomingConstructionTasks)
      : upcomingDeadlines,
    upcomingScheduleMeta: {
      source: upcomingConstructionTasks.length ? 'timeline_tasks' : 'project_end_dates',
      openTaskCount: upcomingConstruction.count,
      taskDeadlineDays: parsedTaskDays,
    },
    projectTimelineOverall,
    freightCarriers,
    recentActivity: recentActivity.slice(0, 15),
    recentDeliveries,
  })
})

/** GET /timeline/overall — Project Timeline (Overall) widget; optional dashboard filters. */
exports.getTimelineOverall = asyncHandler(async (req, res) => {
  const parsed = parseDashboardFilters(req.query)
  if (parsed.error) return badRequest(res, parsed.error)

  const leadIds = await getConstructionLeadIds(parsed)
  if (!leadIds.length) {
    return success(res, { projectTimelineOverall: buildOverallTimelineFromLeads([]), projectCount: 0 })
  }

  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select('lifecycleStatus lifecycleHistory')
    .lean()

  return success(res, {
    filtersApplied: {
      projectId: parsed.projectId,
      buildingId: parsed.buildingId,
      status: parsed.status,
      businessUnit: parsed.businessUnit ?? null,
    },
    projectCount: leads.length,
    projectTimelineOverall: buildOverallTimelineFromLeads(leads),
  })
})

const emptyConstructionProjectStats = () => ({
  total: 0,
  totalIncludingCompleted: 0,
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
})

const buildDeliveryOverviewForExport = (deliveriesInRange, deliveryScope) => {
  const deliveryOverview = {
    scope: deliveryScope.scope,
    fromDate: deliveryScope.fromDate,
    toDate: deliveryScope.toDate,
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
  return deliveryOverview
}

const buildMaterialRequestOverviewForExport = (materialRequests) => {
  const mrPending = materialRequests.filter((m) => m.status === 'pending').length
  const mrApproved = materialRequests.filter((m) => m.status === 'approved').length
  const mrRejected = materialRequests.filter((m) => m.status === 'rejected').length
  const mrUrgent = materialRequests.filter(
    (m) => m.priority === 'critical' || m.priority === 'high'
  ).length
  const mrTotal = materialRequests.length
  return {
    pendingApproval: mrPending,
    approved: mrApproved,
    rejected: mrRejected,
    urgent: mrUrgent,
    total: mrTotal,
    approvedPct: pct(mrApproved, mrTotal),
    pendingApprovalPct: pct(mrPending, mrTotal),
    rejectedPct: pct(mrRejected, mrTotal),
  }
}

const buildFreightCarriersForExport = async (deliveriesInRange) => {
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
  const freightRows = [...carrierLoadMap.values()]
  const totalLoadsToday = freightRows.reduce((s, r) => s + r.loadsToday, 0)
  const freightOnTime = freightRows.reduce((s, r) => s + r.onTime, 0)
  const freightDelayed = freightRows.reduce((s, r) => s + r.delayed, 0)
  return {
    rows: freightRows,
    totals: {
      totalLoadsToday,
      onTime: freightOnTime,
      onTimePct: pct(freightOnTime, totalLoadsToday),
      delayed: freightDelayed,
      delayedPct: pct(freightDelayed, totalLoadsToday),
    },
  }
}

/** GET /dashboard/export — Excel aligned with GET /dashboard (same filters + KPIs + widgets). */
exports.exportDashboard = asyncHandler(async (req, res) => {
  const parsed = parseDashboardFilters(req.query)
  if (parsed.error) return badRequest(res, parsed.error)

  const leadIds = await getConstructionLeadIds(parsed)
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const deliveryScope = resolveDeliveryScopeForDashboard(parsed, now)

  let projectStats = emptyConstructionProjectStats()
  let projects = []
  let deliveryOverview = buildDeliveryOverviewForExport([], deliveryScope)
  let materialRequestOverview = buildMaterialRequestOverviewForExport([])
  let activeSites = []
  let upcomingDeadlines = []
  let freightCarriers = {
    rows: [],
    totals: { totalLoadsToday: 0, onTime: 0, onTimePct: 0, delayed: 0, delayedPct: 0 },
  }

  if (leadIds.length) {
    const context = await loadStatsContextForLeadIds(leadIds, { todayStart, todayEnd, now })
    projectStats = computeProjectStats(context, now)
    projects = buildAllProjectsExportRows(context, now)
    activeSites = buildActiveSites(context, { now, limit: null })
    upcomingDeadlines = context.upcomingDeadlineLeads.map((l) => ({
      projectName: l.projectName,
      jobId: l.jobId,
      location: l.location,
      endDate: l.endDate,
      daysLeft: Math.ceil((new Date(l.endDate) - now) / (1000 * 60 * 60 * 24)),
    }))

    const [deliveriesInRange, materialRequests] = await Promise.all([
      Delivery.find({
        leadId: { $in: leadIds },
        status: { $nin: ['draft', 'cancelled'] },
        ...(deliveryScope.deliveryDateFilter || {}),
      })
        .select('status deliveryDate selectedCarrierBidId')
        .lean(),
      MaterialRequest.find({ leadId: { $in: leadIds } }).select('status priority').lean(),
    ])

    deliveryOverview = buildDeliveryOverviewForExport(deliveriesInRange, deliveryScope)
    materialRequestOverview = buildMaterialRequestOverviewForExport(materialRequests)
    freightCarriers = await buildFreightCarriersForExport(deliveriesInRange)
  }

  const filtersApplied = {
    projectId: parsed.projectId,
    buildingId: parsed.buildingId,
    status: parsed.status,
    businessUnit: parsed.businessUnit ?? null,
    fromDate: parsed.fromDate,
    toDate: parsed.toDate,
  }

  const buffer = await generateConstructionDashboardExcel({
    projectStats,
    projects,
    exportedAt: now,
    filtersApplied,
    deliveryOverview,
    materialRequestOverview,
    activeSites,
    upcomingDeadlines,
    freightCarriers,
  })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="construction-dashboard-export.xlsx"')
  return res.send(buffer)
})

/** Filter dropdown helpers for the dashboard controls. */
exports.getDashboardFilters = asyncHandler(async (req, res) => {
  const businessUnits = BUSINESS_UNITS.map((value) => ({ value, label: getBusinessUnitLabel(value) }))
  const leadIds = await getConstructionLeadIds({})
  if (!leadIds.length) {
    return success(res, {
      projects: [],
      buildings: [],
      statuses: CONSTRUCTION_STAGES,
      businessUnits,
    })
  }

  const [projects, buildings] = await Promise.all([
    Lead.find({ _id: { $in: leadIds } })
      .select('projectName jobId businessUnit lifecycleStatus location')
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
      ...businessUnitFields(p),
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
    businessUnits,
  })
})
