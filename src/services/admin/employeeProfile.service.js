const Lead = require('../../models/Lead')
const FollowUp = require('../../models/FollowUp')
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
const Escalation = require('../../models/Escalation')
const Task = require('../../models/Task')
const Delivery = require('../../models/Delivery')
const POOrder = require('../../models/POOrder')
const DrawingDocument = require('../../models/DrawingDocument')
const BOMJob = require('../../models/BOMJob')
const Building = require('../../models/Building')
const { CLOSED_STAGES, LEAD_TEMPERATURES } = require('../../config/constants')
const { buildDateFilter } = require('../../utils/dateRange')
const { enrichLeadDocument } = require('../../utils/leadProjectId')
const { buildDeliveryCard } = require('../../controllers/construction/delivery.controller')
const {
  formatLifecycleStatusLabel,
  buildPermissionTags,
  formatRoleLabel,
  resolveLeadTemperature,
  formatScoreStateLabel,
  buildWorkSummary,
  ROLE_DISPLAY,
} = require('../../utils/employeeProfile.util')
const { startOfYear, endOfDay } = require('date-fns')

const parsePagination = (query = {}) => {
  const page = Math.max(parseInt(query.assignedPage || query.page, 10) || 1, 1)
  const limit = Math.max(parseInt(query.assignedLimit || query.limit, 10) || 10, 1)
  return { page, limit, skip: (page - 1) * limit }
}

const buildRevenueDateRange = (query = {}) => {
  const explicit = buildDateFilter(query, 'paidAt')
  if (explicit.paidAt) return explicit.paidAt

  const period = String(query.revenuePeriod || 'all').toLowerCase()
  const now = endOfDay(new Date())
  if (period === 'year') {
    return { $gte: startOfYear(now), $lte: now }
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { $gte: start, $lte: now }
  }
  return null
}

const buildHeader = (employee, workCount) => ({
  employeeId: employee._id,
  name: employee.name,
  avatar: employee.avatar || '',
  role: employee.role,
  roleLabel: formatRoleLabel(employee.role, employee.department),
  roleDisplay: ROLE_DISPLAY[employee.role] || employee.role,
  department: employee.department || '',
  joinedAt: employee.createdAt,
  isActive: employee.isActive === true,
  workSummary: buildWorkSummary(employee.role, workCount),
})

const buildPersonalInfo = (employee) => ({
  email: employee.email,
  phone: employee.phone || '',
  joinDate: employee.createdAt,
  role: employee.role,
  roleDisplay: ROLE_DISPLAY[employee.role] || employee.role,
  department: employee.department || '',
  permissionTags: buildPermissionTags(employee.permissions),
  permissions: employee.permissions || {},
})

const mapSalesLeadItem = (lead) => {
  const jobId = lead.jobId || ''
  const temperature = resolveLeadTemperature(lead)
  const customerName = [lead.customerId?.firstName, lead.customerId?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || lead.customerId?.firstName || ''

  return {
    leadId: lead._id,
    customerName,
    jobId,
    projectId: jobId,
    projectName: lead.projectName || '',
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    status: lead.lifecycleStatus,
    statusLabel: formatLifecycleStatusLabel(lead.lifecycleStatus),
    quoteValue: lead.quoteValue ?? 0,
    score: lead.leadScoring?.score ?? 0,
    temperature,
    scoreStateLabel: formatScoreStateLabel(temperature),
    isTerminated: !!lead.isTerminated,
    createdAt: lead.createdAt,
    lead: enrichLeadDocument(lead),
  }
}

const buildSalesAssignedWork = async (employeeId, query = {}) => {
  const { page, limit, skip } = parsePagination(query)
  const dateFilter = buildDateFilter(query, 'createdAt')
  const bucket = String(query.lifecycleBucket || 'all').toLowerCase()

  const filter = { assignedSales: employeeId, ...dateFilter }
  if (bucket === 'active') {
    filter.isTerminated = { $ne: true }
    filter.lifecycleStatus = { $nin: CLOSED_STAGES }
  } else if (bucket === 'closed') {
    filter.lifecycleStatus = { $in: CLOSED_STAGES }
  }

  const temperature = query.scoreState || query.temperature || query.status
  if (temperature && LEAD_TEMPERATURES.includes(String(temperature).toLowerCase())) {
    filter['leadScoring.temperature'] = String(temperature).toLowerCase()
  }

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: 'firstName lastName email customerId' })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return {
    kind: 'sales_leads',
    total,
    page,
    limit,
    lifecycleBucket: bucket,
    items: leads.map(mapSalesLeadItem),
  }
}

const buildPlantAssignedWork = async (employeeId, query = {}) => {
  const { page, limit, skip } = parsePagination(query)
  const poDateFilter = buildDateFilter(query, 'createdAt')
  const poFilter = { assignedTo: employeeId, ...poDateFilter }

  const poLeadIds = await POOrder.distinct('leadId', poFilter)
  const sortedLeadRefs = await Lead.find({ _id: { $in: poLeadIds } })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean()
  const total = sortedLeadRefs.length
  const pageLeadIds = sortedLeadRefs.slice(skip, skip + limit).map((row) => row._id)

  const [leads, buildingCounts] = await Promise.all([
    Lead.find({ _id: { $in: pageLeadIds } })
      .populate({ path: 'customerId', select: 'firstName lastName' })
      .sort({ createdAt: -1 })
      .lean(),
    Building.aggregate([
      { $match: { leadId: { $in: pageLeadIds } } },
      { $group: { _id: '$leadId', count: { $sum: 1 } } },
    ]),
  ])
  const buildingCountMap = new Map(buildingCounts.map((b) => [String(b._id), b.count]))

  const items = leads.map((lead) => ({
    leadId: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    projectId: lead.jobId || '',
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    customerName: lead.customerId
      ? `${lead.customerId.firstName || ''} ${lead.customerId.lastName || ''}`.trim()
      : '',
    buildingsCount: buildingCountMap.get(String(lead._id)) || 0,
    status: lead.lifecycleStatus,
    statusLabel: formatLifecycleStatusLabel(lead.lifecycleStatus),
    projectValue: lead.quoteValue ?? 0,
  }))

  return {
    kind: 'plant_projects',
    total,
    page,
    limit,
    items,
  }
}

const buildConstructionAssignedWork = async (employeeId, query = {}) => {
  const { page, limit, skip } = parsePagination(query)
  const taskLeadIds = await Task.distinct('leadId', { assignedTo: employeeId })
  const total = taskLeadIds.length
  const pageLeadIds = taskLeadIds.slice(skip, skip + limit)

  const deliveriesRaw = await Delivery.find({ leadId: { $in: pageLeadIds } })
    .populate({ path: 'leadId', select: 'projectName jobId location buildingType' })
    .sort({ updatedAt: -1 })
    .lean()

  const assignedDeliveries = await Promise.all(deliveriesRaw.map(buildDeliveryCard))

  return {
    kind: 'construction_deliveries',
    total,
    page,
    limit,
    items: assignedDeliveries,
  }
}

const buildAccountAssignedWork = async (employeeId, query = {}) => {
  const { page, limit, skip } = parsePagination(query)
  const dateFilter = buildDateFilter(query, 'createdAt')
  const filter = { createdBy: employeeId, ...dateFilter }

  const [invoices, total] = await Promise.all([
    Invoice.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ])

  return {
    kind: 'account_invoices',
    total,
    page,
    limit,
    items: invoices.map((inv) => ({
      invoiceId: inv._id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      statusLabel: formatLifecycleStatusLabel(inv.status) || capitalizeStatus(inv.status),
      totalAmount: inv.totalAmount ?? 0,
      leadId: inv.leadId,
      createdAt: inv.createdAt,
    })),
  }
}

const capitalizeStatus = (value) =>
  String(value || '')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')

const buildSalesPerformance = async (employeeId, query = {}) => {
  const leadDateFilter = buildDateFilter(query, 'createdAt')
  const followUpDateFilter = buildDateFilter(query, 'followUpDate')
  const activityDateFilter = buildDateFilter(query, 'createdAt')
  const revenueDateRange = buildRevenueDateRange(query)

  const leadBase = { assignedSales: employeeId, ...leadDateFilter }
  const revenueMatch = { 'lead.assignedSales': employeeId, status: 'paid' }
  if (revenueDateRange) revenueMatch.paidAt = revenueDateRange

  const [
    totalLeads,
    closedLeads,
    followUpsTotal,
    followUpsCompleted,
    quotationsCreated,
    escalationsRaised,
    revenueAgg,
  ] = await Promise.all([
    Lead.countDocuments(leadBase),
    Lead.countDocuments({ ...leadBase, lifecycleStatus: { $in: CLOSED_STAGES } }),
    FollowUp.countDocuments({ assignedTo: employeeId, ...followUpDateFilter }),
    FollowUp.countDocuments({ assignedTo: employeeId, status: 'completed', ...followUpDateFilter }),
    Quotation.countDocuments({ createdBy: employeeId, ...activityDateFilter }),
    Escalation.countDocuments({ raisedBy: employeeId, ...activityDateFilter }),
    Invoice.aggregate([
      { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
      { $unwind: '$lead' },
      { $match: revenueMatch },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
  ])

  const revenuePeriod = String(query.revenuePeriod || 'all').toLowerCase()
  const revenuePeriodLabel =
    revenuePeriod === 'year'
      ? 'This Year'
      : revenuePeriod === 'month'
        ? 'This Month'
        : 'All Time'

  return {
    kind: 'sales',
    metrics: {
      leadsClosed: closedLeads,
      conversionRate: totalLeads > 0 ? Math.round((closedLeads / totalLeads) * 100) : 0,
      followUpsCompletedPercent:
        followUpsTotal > 0 ? Math.round((followUpsCompleted / followUpsTotal) * 100) : 0,
      followUpsTotal,
      followUpsCompleted,
      customerSatisfaction: null,
      revenueGenerated: revenueAgg[0]?.total || 0,
      revenuePeriodLabel,
      quotesCreated: quotationsCreated,
      escalationsRaised,
      totalLeads,
    },
  }
}

const buildPlantPerformance = async (employeeId, query = {}) => {
  const docDateFilter = buildDateFilter(query, 'createdAt')
  const poLeadIds = await POOrder.distinct('leadId', { assignedTo: employeeId })

  const [drawingsUploaded, drawingsApproved, bomPending, bomApproved, bomRejected] =
    await Promise.all([
      DrawingDocument.countDocuments({ uploadedBy: employeeId, ...docDateFilter }),
      DrawingDocument.countDocuments({ uploadedBy: employeeId, status: 'approved', ...docDateFilter }),
      BOMJob.countDocuments({
        uploadedBy: employeeId,
        status: { $in: ['queued', 'processing'] },
        ...docDateFilter,
      }),
      BOMJob.countDocuments({ uploadedBy: employeeId, status: 'completed', ...docDateFilter }),
      BOMJob.countDocuments({ uploadedBy: employeeId, status: 'failed', ...docDateFilter }),
    ])

  return {
    kind: 'plant',
    metrics: {
      totalProjects: poLeadIds.length,
      drawingsUploaded,
      drawingApprovalRate:
        drawingsUploaded > 0 ? Math.round((drawingsApproved / drawingsUploaded) * 100) : 0,
      bomSubmissionPending: bomPending,
      bomSubmissionApproved: bomApproved,
      bomSubmissionRejected: bomRejected,
    },
  }
}

const buildConstructionPerformance = async (employeeId) => {
  const taskLeadIds = await Task.distinct('leadId', { assignedTo: employeeId })
  const [tasksTotal, tasksDone, tasksInProgress, deliveriesHandled, invoicesRaised] =
    await Promise.all([
      Task.countDocuments({ assignedTo: employeeId }),
      Task.countDocuments({ assignedTo: employeeId, status: 'done' }),
      Task.countDocuments({ assignedTo: employeeId, status: 'in_progress' }),
      Delivery.countDocuments({ 'statusHistory.changedBy': employeeId }),
      Invoice.countDocuments({ createdBy: employeeId }),
    ])

  return {
    kind: 'construction',
    metrics: {
      totalProjects: taskLeadIds.length,
      tasksTotal,
      tasksDone,
      tasksInProgress,
      tasksCompletionRate: tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0,
      deliveriesHandled,
      invoicesRaised,
    },
  }
}

const buildAccountPerformance = async (employeeId, query = {}) => {
  const dateFilter = buildDateFilter(query, 'createdAt')
  const paidDateFilter = buildDateFilter(query, 'paidAt')
  const [invoicesCreated, invoicesMarkedPaid, revenueCollectedAgg] = await Promise.all([
    Invoice.countDocuments({ createdBy: employeeId, ...dateFilter }),
    Invoice.countDocuments({ paidBy: employeeId, ...dateFilter }),
    Invoice.aggregate([
      {
        $match: {
          paidBy: employeeId,
          status: 'paid',
          ...(paidDateFilter.paidAt ? { paidAt: paidDateFilter.paidAt } : {}),
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
  ])

  return {
    kind: 'account',
    metrics: {
      invoicesCreated,
      invoicesMarkedPaid,
      revenueCollected: revenueCollectedAgg[0]?.total || 0,
    },
  }
}

const resolveWorkCount = async (employee) => {
  if (employee.role === 'sales') {
    return Lead.countDocuments({ assignedSales: employee._id })
  }
  if (employee.role === 'plant') {
    return POOrder.distinct('leadId', { assignedTo: employee._id }).then((ids) => ids.length)
  }
  if (employee.role === 'construction') {
    return Task.distinct('leadId', { assignedTo: employee._id }).then((ids) => ids.length)
  }
  if (employee.role === 'account') {
    return Invoice.countDocuments({ createdBy: employee._id })
  }
  return 0
}

const buildAssignedWork = async (employee, query) => {
  if (employee.role === 'sales') return buildSalesAssignedWork(employee._id, query)
  if (employee.role === 'plant') return buildPlantAssignedWork(employee._id, query)
  if (employee.role === 'construction') return buildConstructionAssignedWork(employee._id, query)
  if (employee.role === 'account') return buildAccountAssignedWork(employee._id, query)
  return { kind: 'none', total: 0, page: 1, limit: 10, items: [] }
}

const buildPerformance = async (employee, query) => {
  if (employee.role === 'sales') return buildSalesPerformance(employee._id, query)
  if (employee.role === 'plant') return buildPlantPerformance(employee._id, query)
  if (employee.role === 'construction') return buildConstructionPerformance(employee._id)
  if (employee.role === 'account') return buildAccountPerformance(employee._id, query)
  return { kind: 'admin', metrics: {} }
}

const buildEmployeeProfile = async (employee, query = {}) => {
  const workCount = await resolveWorkCount(employee)
  const [assignedWork, performance] = await Promise.all([
    buildAssignedWork(employee, query),
    buildPerformance(employee, query),
  ])

  return {
    header: buildHeader(employee, workCount),
    personalInfo: buildPersonalInfo(employee),
    assignedWork,
    performance,
    employee: {
      _id: employee._id,
      name: employee.name,
      email: employee.email,
      phone: employee.phone || '',
      role: employee.role,
      department: employee.department || '',
      isActive: employee.isActive === true,
      avatar: employee.avatar || '',
      permissions: employee.permissions || {},
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    },
  }
}

module.exports = {
  buildEmployeeProfile,
}
