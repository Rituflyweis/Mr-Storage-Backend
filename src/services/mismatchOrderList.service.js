const BundleMismatchOrder = require('../models/BundleMismatchOrder')
const Lead = require('../models/Lead')
const { MISMATCH_ORDER_STATUSES } = require('../models/BundleMismatchOrder')
const { buildDateFilter } = require('../utils/dateRange')

const listPopulate = [
  { path: 'bundleId', select: 'bundleNo bundleType status' },
  { path: 'leadId', select: 'projectName jobId location' },
  { path: 'reportedBy', select: 'name email' },
  { path: 'reviewedBy', select: 'name email' },
]

exports.mapMismatchRow = (row) => ({
  mismatchId: row._id,
  mismatchOrderId: row.mismatchOrderId,
  status: row.status,
  reason: row.reason,
  notes: row.notes,
  actionNotes: row.actionNotes || '',
  items: row.items || [],
  photos: row.photos || [],
  bundleId: row.bundleId?._id || row.bundleId,
  bundleNo: row.bundleNo || row.bundleId?.bundleNo || '',
  leadId: row.leadId?._id || row.leadId,
  projectName: row.leadId?.projectName || '',
  jobId: row.leadId?.jobId || '',
  reportedBy: row.reportedBy
    ? { _id: row.reportedBy._id, name: row.reportedBy.name, email: row.reportedBy.email }
    : null,
  reviewedBy: row.reviewedBy
    ? { _id: row.reviewedBy._id, name: row.reviewedBy.name, email: row.reviewedBy.email }
    : null,
  resolvedAt: row.resolvedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

exports.buildMismatchOrderListFilter = async (query = {}, { scopedLeadIds } = {}) => {
  const filter = {
    ...buildDateFilter(query, 'createdAt'),
  }

  const projectId = query.projectId || query.leadId
  if (projectId) filter.leadId = projectId

  if (scopedLeadIds) {
    const ids = scopedLeadIds
    if (projectId) {
      filter.leadId = ids.some((id) => String(id) === String(projectId)) ? projectId : { $in: [] }
    } else {
      filter.leadId = { $in: ids }
    }
  }

  const status = query.status
  if (status && status !== 'All' && status !== 'all') {
    const normalized = String(status).trim().toLowerCase()
    if (MISMATCH_ORDER_STATUSES.includes(normalized)) filter.status = normalized
  }

  const search = String(query.search || '').trim()
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const leadIdsFromProject = await Lead.find({
      $or: [{ projectName: rx }, { jobId: rx }],
    })
      .distinct('_id')
    const or = [
      { mismatchOrderId: rx },
      { reason: rx },
      { notes: rx },
      { bundleNo: rx },
    ]
    if (leadIdsFromProject.length) or.push({ leadId: { $in: leadIdsFromProject } })
    filter.$or = or
  }

  return filter
}

exports.listMismatchOrders = async (query = {}, options = {}) => {
  const { page = 1, limit = 20, scopedLeadIds } = options
  const filter = await exports.buildMismatchOrderListFilter(query, { scopedLeadIds })
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200)
  const skip = (parsedPage - 1) * parsedLimit

  const [rows, total] = await Promise.all([
    BundleMismatchOrder.find(filter)
      .populate(listPopulate)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    BundleMismatchOrder.countDocuments(filter),
  ])

  return {
    mismatchOrders: rows.map(exports.mapMismatchRow),
    total,
    page: parsedPage,
    limit: parsedLimit,
  }
}
