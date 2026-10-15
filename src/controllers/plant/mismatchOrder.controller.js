const BundleMismatchOrder = require('../../models/BundleMismatchOrder')
const { MISMATCH_ORDER_STATUSES } = require('../../models/BundleMismatchOrder')
const MaterialRequest = require('../../models/MaterialRequest')
const Lead = require('../../models/Lead')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')
const materialRequestList = require('../../services/materialRequestList.service')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const assertPlantProjectAccess = async (req, leadId) => {
  const scoped = (await getScopedLeadIds(req)).map(String)
  if (!scoped.length) return false
  return scoped.includes(String(leadId))
}

const mapMismatchRow = (row) => ({
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

exports.listProjectMismatchOrders = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const lead = await Lead.findById(leadId).select('_id projectName jobId').lean()
  if (!lead) return notFound(res, 'Project not found')
  if (!(await assertPlantProjectAccess(req, leadId))) {
    return forbidden(res, 'This project is outside your plant scope')
  }

  const { page = 1, limit = 20, status } = req.query
  const filter = { leadId }
  if (status && MISMATCH_ORDER_STATUSES.includes(status)) filter.status = status

  const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1)
  const parsedLimit = Math.min(Math.max(Number(limit), 1), 200)

  const [rows, total] = await Promise.all([
    BundleMismatchOrder.find(filter)
      .populate('bundleId', 'bundleNo bundleType status')
      .populate('leadId', 'projectName jobId')
      .populate('reportedBy', 'name email')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    BundleMismatchOrder.countDocuments(filter),
  ])

  return success(res, {
    leadId: lead._id,
    projectName: lead.projectName,
    jobId: lead.jobId,
    mismatchOrders: rows.map(mapMismatchRow),
    total,
    page: Number(page),
    limit: parsedLimit,
  })
})

exports.listProjectAdditionalMaterialRequests = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')
  if (!(await assertPlantProjectAccess(req, leadId))) {
    return forbidden(res, 'This project is outside your plant scope')
  }

  const scopedLeadIds = (await getScopedLeadIds(req)).map(String)
  const listQuery = { ...req.query, leadId }
  // Project tab shows all inbound MRs for plant (construction site + customer portal).
  // Optional ?source=customer|construction to match legacy "additional orders" filter.
  if (req.query.source && ['customer', 'construction'].includes(req.query.source)) {
    listQuery.source = req.query.source
  }

  const data = await materialRequestList.listMaterialRequests(listQuery, {
    page: req.query.page,
    limit: req.query.limit,
    scopedLeadIds,
  })

  return success(res, {
    leadId,
    additionalMaterialRequests: data.materialRequests,
    total: data.total,
    page: data.page,
    limit: data.limit,
  })
})

exports.updateMismatchOrderStatus = asyncHandler(async (req, res) => {
  const order = await BundleMismatchOrder.findById(req.params.mismatchId)
  if (!order) return notFound(res, 'Mismatch order not found')
  if (!(await assertPlantProjectAccess(req, order.leadId))) {
    return forbidden(res, 'This mismatch order is outside your plant scope')
  }

  const { status, actionNotes } = req.body
  if (status !== undefined) {
    if (!MISMATCH_ORDER_STATUSES.includes(status)) {
      return badRequest(res, `status must be one of: ${MISMATCH_ORDER_STATUSES.join(', ')}`)
    }
    order.status = status
    if (status === 'resolved' || status === 'closed') {
      order.resolvedAt = new Date()
      order.reviewedBy = req.user._id
    }
  }
  if (actionNotes !== undefined) order.actionNotes = String(actionNotes).trim()

  await order.save()

  const populated = await BundleMismatchOrder.findById(order._id)
    .populate('bundleId', 'bundleNo')
    .populate('leadId', 'projectName jobId')
    .populate('reportedBy', 'name email')
    .populate('reviewedBy', 'name email')
    .lean()

  return success(res, { mismatchOrder: mapMismatchRow(populated) }, 'Mismatch order updated')
})
