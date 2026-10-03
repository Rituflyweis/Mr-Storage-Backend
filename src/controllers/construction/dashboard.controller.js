const mongoose = require('mongoose')
const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const Bundle = require('../../models/Bundle')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { DELIVERY_FULFILLMENT_STATUSES } = require('../../config/constants')
const {
  ARRIVED_STATUSES,
  ISSUE_STATUSES,
  ISSUE_OUTCOMES,
  OUTCOME_LABELS,
  getDayRange,
  lastStatusChange,
  isCompleted,
  getMaterialName,
  buildTrackingCards,
} = require('../../services/construction/deliveryTracking.service')

const RECEIVED_STATUSES = ['received', 'partial_received']
// Granular fulfillment steps still roll up into "inTransit" for this coarse dashboard stat.
const IN_TRANSIT_ROLLUP_STATUSES = new Set(DELIVERY_FULFILLMENT_STATUSES.filter((s) => s !== 'delivered'))

const CONSTRUCTION_STAGES = [
  'released_to_plant', 'drawings_received', 'bom_received', 'bom_review',
  'material_check', 'production_planning', 'fabrication_started', 'quality_inspection',
  'packing_bundling', 'shipper_prepared', 'ready_for_delivery', 'dispatched', 'delivered',
]
const CONSTRUCTION_ACTIVE_STAGES = [
  'released_to_plant', 'drawings_received', 'bom_received', 'bom_review',
  'material_check', 'production_planning', 'fabrication_started', 'quality_inspection',
  'packing_bundling', 'shipper_prepared', 'ready_for_delivery',
]

const getConstructionLeadIds = async () => {
  const leads = await Lead.find({
    lifecycleStatus: { $in: CONSTRUCTION_STAGES },
    isTerminated: { $ne: true },
  }).select('_id').lean()
  return leads.map((l) => l._id)
}

exports.getDashboard = asyncHandler(async (req, res) => {
  const leadIds = await getConstructionLeadIds()
  const now = new Date()
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const [
    totalProjects,
    activeProjects,
    completedProjects,
    deliveries,
    tasks,
    upcomingDeadlineLeads,
  ] = await Promise.all([
    Lead.countDocuments({ _id: { $in: leadIds } }),
    Lead.countDocuments({ _id: { $in: leadIds }, lifecycleStatus: { $in: CONSTRUCTION_ACTIVE_STAGES } }),
    Lead.countDocuments({ _id: { $in: leadIds }, lifecycleStatus: 'delivered' }),
    Delivery.find({ leadId: { $in: leadIds }, status: { $ne: 'draft' } })
      .select('status deliveryDate leadId')
      .populate('leadId', 'projectName jobId location')
      .lean(),
    Task.find({ leadId: { $in: leadIds } }).select('status priority dueDate').lean(),
    Lead.find({
      _id: { $in: leadIds },
      endDate: { $gte: now, $lte: thirtyDaysLater },
    }).select('projectName jobId endDate location').sort({ endDate: 1 }).limit(5).lean(),
  ])

  const delayedProjects = await Lead.countDocuments({
    _id: { $in: leadIds },
    endDate: { $lt: now },
    lifecycleStatus: { $nin: ['delivered'] },
  })

  const onTrack = totalProjects - delayedProjects - completedProjects

  const deliveryOverview = {
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
    inTransit: deliveries.filter((d) => IN_TRANSIT_ROLLUP_STATUSES.has(d.status)).length,
    outForDelivery: deliveries.filter((d) => d.status === 'scheduled' || d.status === 'confirmed').length,
    delayed: deliveries.filter((d) => d.status === 'delayed').length,
    total: deliveries.length,
  }

  const taskOverview = {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === 'todo').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
    overdue: tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'done').length,
  }

  const recentDeliveries = deliveries
    .filter((d) => IN_TRANSIT_ROLLUP_STATUSES.has(d.status) || d.status === 'delivered')
    .sort((a, b) => new Date(b.deliveryDate || 0) - new Date(a.deliveryDate || 0))
    .slice(0, 5)
    .map((d) => ({
      deliveryId: d._id,
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
    projectStats: {
      total: totalProjects,
      onTrack,
      delayed: delayedProjects,
      completed: completedProjects,
      completionRate: totalProjects ? Math.round((completedProjects / totalProjects) * 100) : 0,
      upcomingDeadlines: upcomingDeadlineLeads.length,
    },
    deliveryOverview,
    taskOverview,
    upcomingDeadlines: upcomingDeadlineLeads.map((l) => ({
      leadId: l._id,
      projectName: l.projectName,
      jobId: l.jobId,
      location: l.location,
      endDate: l.endDate,
      daysLeft: Math.ceil((new Date(l.endDate) - now) / (1000 * 60 * 60 * 24)),
    })),
    recentDeliveries,
  })
})

// ── Home (Construction mobile app "Deliveries — Construction Site Performance" screen) ──

// Picks the project the site manager is working on today: an explicit leadId, else the
// construction project with the earliest delivery today, else the most recently updated one.
const resolveCurrentProject = async (leadId, leadIds, dayRange) => {
  const select = 'projectName jobId location city state lifecycleStatus'
  if (leadId) return Lead.findById(leadId).select(select).lean()

  const todaysDelivery = await Delivery.findOne({
    leadId: { $in: leadIds },
    status: { $nin: ['draft', 'cancelled'] },
    deliveryDate: { $gte: dayRange.start, $lt: dayRange.end },
  }).sort({ deliveryDate: 1 }).select('leadId').lean()
  if (todaysDelivery) return Lead.findById(todaysDelivery.leadId).select(select).lean()

  return Lead.findOne({ _id: { $in: leadIds }, lifecycleStatus: { $in: CONSTRUCTION_ACTIVE_STAGES } })
    .sort({ updatedAt: -1 })
    .select(select)
    .lean()
}

// GET /home?leadId=&date=YYYY-MM-DD
exports.getHome = asyncHandler(async (req, res) => {
  const { leadId, date } = req.query
  const dayRange = getDayRange(date)
  if (!dayRange) return badRequest(res, 'date must be a valid date (YYYY-MM-DD)')
  if (leadId && !mongoose.Types.ObjectId.isValid(leadId)) return badRequest(res, 'Invalid leadId')

  const leadIds = await getConstructionLeadIds()
  const project = await resolveCurrentProject(leadId, leadIds, dayRange)
  if (leadId && !project) return notFound(res, 'Project not found')

  const user = { name: req.user?.name || '', role: req.user?.role || '' }
  if (!project) {
    return success(res, {
      user,
      currentProject: null,
      stats: { todaysDeliveries: 0, receivedToday: 0, arrived: 0, issuesReported: 0 },
      incomingDeliveries: [],
      alerts: [],
    })
  }

  const [todaysDeliveries, receivedToday, issueDeliveries, mismatchedBundles] = await Promise.all([
    Delivery.find({
      leadId: project._id,
      status: { $nin: ['draft', 'cancelled'] },
      deliveryDate: { $gte: dayRange.start, $lt: dayRange.end },
    }).sort({ deliveryDate: 1 }).lean(),
    Delivery.countDocuments({
      leadId: project._id,
      statusHistory: {
        $elemMatch: { status: { $in: RECEIVED_STATUSES }, changedAt: { $gte: dayRange.start, $lt: dayRange.end } },
      },
    }),
    Delivery.find({
      leadId: project._id,
      $or: [{ status: { $in: ISSUE_STATUSES } }, { 'receipt.outcome': { $in: ISSUE_OUTCOMES } }],
    })
      .select('deliveryNumber status loadDescription materialType additionalNotes statusHistory receipt updatedAt')
      .sort({ updatedAt: -1 })
      .lean(),
    Bundle.find({ leadId: project._id, mismatchReportedAt: { $ne: null } })
      .select('bundleNo title mismatchNotes mismatchReportedAt mismatchItems')
      .sort({ mismatchReportedAt: -1 })
      .lean(),
  ])

  // Everything the site still has to act on today: on the way, arrived, or awaiting verification.
  const openToday = todaysDeliveries.filter((d) => !isCompleted(d))
  const incomingDeliveries = await buildTrackingCards(openToday)

  const issueAlert = (d) => {
    if (d.receipt?.outcome && ISSUE_OUTCOMES.includes(d.receipt.outcome)) {
      return {
        type: d.receipt.outcome,
        title: OUTCOME_LABELS[d.receipt.outcome],
        message: d.receipt.notes || `${d.deliveryNumber} — ${d.receipt.totalReceived}/${d.receipt.totalExpected} units received`,
        reportedAt: d.receipt.confirmedAt,
      }
    }
    if (d.status === 'delayed') {
      return { type: 'delivery_delayed', title: 'Delivery Delayed', reportedAt: lastStatusChange(d, ['delayed']) }
    }
    return { type: 'partial_delivery', title: 'Partial Delivery Received', reportedAt: lastStatusChange(d, [d.status]) }
  }

  const alerts = [
    ...issueDeliveries.map((d) => {
      const alert = issueAlert(d)
      return {
        ...alert,
        message: alert.message || d.additionalNotes || `${d.deliveryNumber} — ${getMaterialName(d) || 'Material'}`,
        deliveryId: d._id,
        deliveryNumber: d.deliveryNumber,
        reportedAt: alert.reportedAt || d.updatedAt,
      }
    }),
    ...mismatchedBundles.map((b) => ({
      type: 'bundle_mismatch',
      title: 'Material Mismatch',
      message: b.mismatchNotes,
      bundleId: b._id,
      bundleNo: b.bundleNo,
      affectedItems: (b.mismatchItems || []).length,
      reportedAt: b.mismatchReportedAt,
    })),
  ].sort((a, b) => new Date(b.reportedAt || 0) - new Date(a.reportedAt || 0))

  return success(res, {
    user,
    currentProject: {
      leadId: project._id,
      projectName: project.projectName,
      jobId: project.jobId,
      location: project.location || [project.city, project.state].filter(Boolean).join(', '),
      lifecycleStatus: project.lifecycleStatus,
    },
    stats: {
      todaysDeliveries: todaysDeliveries.length,
      receivedToday,
      arrived: openToday.filter((d) => ARRIVED_STATUSES.includes(d.status)).length,
      issuesReported: alerts.length,
    },
    incomingDeliveries,
    alerts,
  })
})
