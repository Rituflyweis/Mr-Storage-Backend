const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const Task = require('../../models/Task')
const Bundle = require('../../models/Bundle')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

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
    inTransit: deliveries.filter((d) => d.status === 'in_transit').length,
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
    .filter((d) => d.status === 'in_transit' || d.status === 'delivered')
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
