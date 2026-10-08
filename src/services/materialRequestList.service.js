const MaterialRequest = require('../models/MaterialRequest')
const Lead = require('../models/Lead')
const { buildDateFilter } = require('../utils/dateRange')

const customerDisplayName = (customer) => {
  if (!customer || typeof customer !== 'object') return ''
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim()
}

exports.mapMaterialRequestRow = (mr) => {
  const customerName = customerDisplayName(mr.requestedByCustomer)
  const staff = mr.requestedBy
  return {
    requestId: mr.requestId,
    _id: mr._id,
    source: mr.source || 'construction',
    project: mr.leadId
      ? {
          leadId: mr.leadId._id || mr.leadId,
          projectName: mr.leadId.projectName,
          jobId: mr.leadId.jobId,
          location: mr.leadId.location,
        }
      : null,
    siteLocation: mr.siteLocation,
    buildingLabel: mr.buildingLabel || '',
    department: mr.department,
    requestedBy: staff
      ? { userId: staff._id, name: staff.name, email: staff.email, role: staff.role }
      : null,
    requestedByCustomer: mr.requestedByCustomer
      ? {
          customerId: mr.requestedByCustomer._id || mr.requestedByCustomer,
          name: customerName,
          email: mr.requestedByCustomer.email || '',
        }
      : null,
    requestedByLabel: customerName || staff?.name || '',
    requestedItems: mr.requestedItems,
    itemCount: mr.requestedItems?.length || 0,
    requestDate: mr.requestDate,
    requiredBy: mr.requiredBy,
    preferredDeliveryDate: mr.preferredDeliveryDate || null,
    priority: mr.priority,
    status: mr.status,
    totalAmount: mr.totalAmount,
    specialInstructions: mr.specialInstructions || '',
    attachments: mr.attachments || [],
    reviewNotes: mr.reviewNotes || '',
    reviewedAt: mr.reviewedAt || null,
    createdAt: mr.createdAt,
    updatedAt: mr.updatedAt,
  }
}

exports.buildMaterialRequestListFilter = async (query = {}, { salesUserId } = {}) => {
  const {
    projectId,
    leadId,
    department,
    status,
    requestedBy,
    priority,
    buildingLabel,
    siteLocation,
    source,
    search,
    startDate,
    endDate,
    dateFrom,
    dateTo,
  } = query

  const filter = {
    ...buildDateFilter({ startDate: startDate || dateFrom, endDate: endDate || dateTo }, 'requestDate'),
  }

  const project = projectId || leadId
  if (project) filter.leadId = project

  if (salesUserId) {
    const leadIds = await Lead.find({ assignedSales: salesUserId }).distinct('_id')
    if (project) {
      filter.leadId = leadIds.some((id) => String(id) === String(project)) ? project : { $in: [] }
    } else {
      filter.leadId = { $in: leadIds }
    }
  }

  if (department && department !== 'All') filter.department = department
  if (status && status !== 'All' && status !== 'All Status') filter.status = status
  if (requestedBy && requestedBy !== 'All') filter.requestedBy = requestedBy
  if (priority && priority !== 'All') filter.priority = priority
  if (buildingLabel) filter.buildingLabel = buildingLabel
  if (siteLocation) filter.siteLocation = siteLocation
  if (source && ['customer', 'construction'].includes(source)) filter.source = source
  if (search?.trim()) filter.requestId = { $regex: search.trim(), $options: 'i' }

  return filter
}

const listPopulate = [
  { path: 'leadId', select: 'projectName jobId location assignedSales' },
  { path: 'requestedBy', select: 'name email role' },
  { path: 'requestedByCustomer', select: 'firstName lastName email' },
  { path: 'reviewedBy', select: 'name role' },
]

exports.listMaterialRequests = async (query = {}, options = {}) => {
  const { page = 1, limit = 20, salesUserId } = options
  const filter = await exports.buildMaterialRequestListFilter(query, { salesUserId })
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const [rows, total, statsAgg] = await Promise.all([
    MaterialRequest.find(filter)
      .populate(listPopulate)
      .sort({ requestDate: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    MaterialRequest.countDocuments(filter),
    MaterialRequest.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }]),
  ])

  const statMap = Object.fromEntries(statsAgg.map((s) => [s._id, { count: s.count, amount: s.amount }]))
  const urgent = await MaterialRequest.countDocuments({
    ...filter,
    priority: { $in: ['high', 'critical'] },
    status: { $in: ['pending', 'approved'] },
  })

  return {
    materialRequests: rows.map(exports.mapMaterialRequestRow),
    requests: rows.map(exports.mapMaterialRequestRow),
    total,
    page: parsedPage,
    limit: parsedLimit,
    stats: {
      total,
      pending: { count: statMap.pending?.count || 0, amount: statMap.pending?.amount || 0 },
      approved: { count: statMap.approved?.count || 0, amount: statMap.approved?.amount || 0 },
      rejected: { count: statMap.rejected?.count || 0, amount: statMap.rejected?.amount || 0 },
      fulfilled: { count: statMap.fulfilled?.count || 0, amount: statMap.fulfilled?.amount || 0 },
      urgent,
      totalRequests: total,
    },
  }
}

exports.getMaterialRequestById = async (requestId, { salesUserId } = {}) => {
  const doc = await MaterialRequest.findById(requestId).populate(listPopulate).lean()
  if (!doc) return null
  if (salesUserId) {
    const lead = doc.leadId
    const assigned = lead?.assignedSales ? String(lead.assignedSales) : null
    if (!assigned || assigned !== String(salesUserId)) return { forbidden: true }
  }
  return { request: exports.mapMaterialRequestRow(doc) }
}

exports.MR_LIST_POPULATE = listPopulate
