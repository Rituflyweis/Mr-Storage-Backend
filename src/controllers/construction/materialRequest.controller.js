const mongoose = require('mongoose')
const MaterialRequest = require('../../models/MaterialRequest')
const { MR_STATUSES, MR_PRIORITIES } = require('../../models/MaterialRequest')
const { escapeRegex } = require('../../utils/leadPayload')
const { CONSTRUCTION_ACTIVE_STAGES, MATERIAL_REQUEST_MATERIAL_TYPES } = require('../../config/constants')

const MR_SOURCES = ['construction', 'customer']
const OrderQuotation = require('../../models/OrderQuotation')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const notificationService = require('../../services/notification.service')

const generateQuotationNumber = async () => {
  const count = await OrderQuotation.countDocuments({})
  return `INV/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`
}

// Next MR-<year>-NNNN after the highest one issued this year (a plain count would repeat
// numbers after a delete and never move past a collision on retry).
const generateRequestId = async () => {
  const prefix = `MR-${new Date().getFullYear()}-`
  const last = await MaterialRequest.findOne({ requestId: { $regex: `^${prefix}\\d+$` } })
    .collation({ locale: 'en', numericOrdering: true })
    .sort({ requestId: -1 })
    .select('requestId')
    .lean()
  const next = last ? Number(last.requestId.slice(prefix.length)) + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

const mapRow = (mr) => ({
  requestId: mr.requestId,
  _id: mr._id,
  project: mr.leadId
    ? { leadId: mr.leadId._id, projectName: mr.leadId.projectName, jobId: mr.leadId.jobId, location: mr.leadId.location }
    : null,
  siteLocation: mr.siteLocation,
  department: mr.department,
  requestedBy: mr.requestedBy
    ? { userId: mr.requestedBy._id, name: mr.requestedBy.name, role: mr.requestedBy.role, department: mr.requestedBy.department || '' }
    : null,
  requestedItems: mr.requestedItems,
  itemCount: mr.requestedItems?.length || 0,
  requestDate: mr.requestDate,
  requiredBy: mr.requiredBy,
  priority: mr.priority,
  status: mr.status,
  remarks: mr.specialInstructions || '',
  attachments: (mr.attachments || []).map((a) => ({ name: a.name, url: a.url, fileSize: a.fileSize })),
  totalAmount: mr.totalAmount,
})

const REQUESTED_BY_FIELDS = 'name email role department'

// A pending request can be withdrawn or given attachments only by the person who raised it (or an admin).
const canManage = (mr, user) => mr.status === 'pending'
  && (user?.role === 'admin' || String(mr.requestedBy?._id || mr.requestedBy) === String(user?._id))

exports.getMaterialRequests = asyncHandler(async (req, res) => {
  const { leadId, department, status, requestedBy, priority, siteLocation, source, search, dateFrom, dateTo } = req.query
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)

  if (status && !MR_STATUSES.includes(status)) return badRequest(res, `Invalid status. Use: ${MR_STATUSES.join(', ')}`)
  if (priority && !MR_PRIORITIES.includes(priority)) return badRequest(res, `Invalid priority. Use: ${MR_PRIORITIES.join(', ')}`)
  if (source && !MR_SOURCES.includes(source)) return badRequest(res, `Invalid source. Use: ${MR_SOURCES.join(', ')}`)
  for (const [key, value] of [['leadId', leadId], ['requestedBy', requestedBy]]) {
    if (value && !mongoose.Types.ObjectId.isValid(value)) return badRequest(res, `Invalid ${key}`)
  }

  // Everything except status — the stat cards show the status split of the filtered set.
  const baseFilter = {}
  if (leadId) baseFilter.leadId = new mongoose.Types.ObjectId(leadId)
  if (department) baseFilter.department = department
  if (requestedBy) baseFilter.requestedBy = new mongoose.Types.ObjectId(requestedBy)
  if (priority) baseFilter.priority = priority
  if (siteLocation) baseFilter.siteLocation = siteLocation
  if (source) baseFilter.source = source
  if (dateFrom || dateTo) {
    baseFilter.requestDate = {}
    if (dateFrom) baseFilter.requestDate.$gte = new Date(dateFrom)
    if (dateTo) baseFilter.requestDate.$lte = new Date(dateTo)
  }
  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i')
    const matchingLeadIds = await Lead.find({ $or: [{ projectName: regex }, { jobId: regex }] }).distinct('_id')
    baseFilter.$or = [
      { requestId: regex },
      { siteLocation: regex },
      { 'requestedItems.name': regex },
      { leadId: { $in: matchingLeadIds } },
    ]
  }
  const filter = status ? { ...baseFilter, status } : baseFilter

  const [rows, total, statusCounts] = await Promise.all([
    MaterialRequest.find(filter)
      .populate('leadId', 'projectName jobId location')
      .populate('requestedBy', REQUESTED_BY_FIELDS)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    MaterialRequest.countDocuments(filter),
    MaterialRequest.aggregate([{ $match: baseFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ])

  const countOf = (s) => statusCounts.find((c) => c._id === s)?.count || 0
  const stats = {
    totalRequests: statusCounts.reduce((sum, c) => sum + c.count, 0),
    pending: countOf('pending'),
    approved: countOf('approved'),
    rejected: countOf('rejected'),
    fulfilled: countOf('fulfilled'),
  }

  return success(res, {
    materialRequests: rows.map(mapRow),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats,
  })
})

// GET /material-requests/filters — populates the Apply Filters screen's dropdowns
exports.getMaterialRequestFilters = asyncHandler(async (req, res) => {
  const [leadIds, siteLocations, departments] = await Promise.all([
    MaterialRequest.distinct('leadId'),
    MaterialRequest.distinct('siteLocation', { siteLocation: { $nin: ['', null] } }),
    MaterialRequest.distinct('department', { department: { $nin: ['', null] } }),
  ])

  const projects = leadIds.length
    ? await Lead.find({ _id: { $in: leadIds } }).select('projectName jobId').sort({ projectName: 1 }).lean()
    : []

  return success(res, {
    statuses: MR_STATUSES,
    priorities: MR_PRIORITIES,
    departments,
    siteLocations,
    projects: projects.map((p) => ({ leadId: p._id, projectName: p.projectName, jobId: p.jobId })),
  })
})

// GET /material-requests/:requestId — "View" → Material Request Details
exports.getMaterialRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) return badRequest(res, 'Invalid requestId')
  const mr = await MaterialRequest.findById(req.params.requestId)
    .populate('leadId', 'projectName jobId location')
    .populate('requestedBy', REQUESTED_BY_FIELDS)
    .populate('reviewedBy', 'name role')
    .populate('cancelledBy', 'name role')
    .lean()
  if (!mr) return notFound(res, 'Material request not found')

  return success(res, {
    materialRequest: {
      ...mapRow(mr),
      review: mr.reviewedAt
        ? { reviewedBy: mr.reviewedBy ? { userId: mr.reviewedBy._id, name: mr.reviewedBy.name } : null, reviewedAt: mr.reviewedAt, notes: mr.reviewNotes || '' }
        : null,
      cancellation: mr.cancelledAt
        ? { cancelledBy: mr.cancelledBy ? { userId: mr.cancelledBy._id, name: mr.cancelledBy.name } : null, cancelledAt: mr.cancelledAt, reason: mr.cancelReason || '' }
        : null,
      canCancel: canManage(mr, req.user),
      canAddAttachments: canManage(mr, req.user),
    },
  })
})

// POST /material-requests/:requestId/attachments { attachments: [{ name, url, fileSize }] }
// Adds files to a pending request after it was created (upload to S3 first via presigned URL).
exports.addMaterialRequestAttachments = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) return badRequest(res, 'Invalid requestId')
  const parsed = parseAttachments(req.body?.attachments)
  if (parsed.error) return badRequest(res, parsed.error)
  if (!parsed.value.length) return badRequest(res, 'attachments is required — send at least one file')

  const mr = await MaterialRequest.findById(req.params.requestId)
  if (!mr) return notFound(res, 'Material request not found')
  if (mr.status !== 'pending') return badRequest(res, `Attachments can only be added to pending requests (this one is ${mr.status})`)
  if (!canManage(mr, req.user)) return forbidden(res, 'Only the person who raised this request can add attachments')

  // Atomic: only while still pending and under the per-request cap.
  const updated = await MaterialRequest.findOneAndUpdate(
    {
      _id: mr._id,
      status: 'pending',
      [`attachments.${MAX_ATTACHMENTS - parsed.value.length}`]: { $exists: false },
    },
    { $push: { attachments: { $each: parsed.value } } },
    { new: true }
  ).lean()
  if (!updated) {
    return badRequest(res, `Cannot add attachments — the request is no longer pending or would exceed ${MAX_ATTACHMENTS} files`)
  }

  return created(res, {
    _id: updated._id,
    requestId: updated.requestId,
    attachments: updated.attachments.map((a) => ({ name: a.name, url: a.url, fileSize: a.fileSize })),
  }, 'Attachments added')
})

// POST /material-requests/:requestId/cancel { reason? } — "Cancel Request"
exports.cancelMaterialRequest = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.requestId)) return badRequest(res, 'Invalid requestId')
  const mr = await MaterialRequest.findById(req.params.requestId)
  if (!mr) return notFound(res, 'Material request not found')
  if (mr.status !== 'pending') return badRequest(res, `Only pending requests can be cancelled (this one is ${mr.status})`)
  if (!canManage(mr, req.user)) return forbidden(res, 'Only the person who raised this request can cancel it')

  // Conditional update so a review landing at the same moment is not overwritten.
  const updated = await MaterialRequest.findOneAndUpdate(
    { _id: mr._id, status: 'pending' },
    { $set: { status: 'cancelled', cancelledBy: req.user._id, cancelledAt: new Date(), cancelReason: String(req.body?.reason || '').trim() } },
    { new: true }
  ).lean()
  if (!updated) return badRequest(res, 'This request was just reviewed and can no longer be cancelled')

  return success(res, {
    _id: updated._id,
    requestId: updated.requestId,
    status: updated.status,
    cancelledAt: updated.cancelledAt,
  }, 'Material request cancelled')
})

// GET /material-requests/form-options — dropdowns + auto-filled date for "Create New Material Request"
exports.getMaterialRequestFormOptions = asyncHandler(async (req, res) => {
  const projects = await Lead.find({ lifecycleStatus: { $in: CONSTRUCTION_ACTIVE_STAGES }, isTerminated: { $ne: true } })
    .select('projectName jobId location')
    .sort({ projectName: 1 })
    .lean()

  return success(res, {
    requestedDate: new Date(),
    priorities: MR_PRIORITIES,
    defaultPriority: 'medium',
    materialTypes: MATERIAL_REQUEST_MATERIAL_TYPES,
    projects: projects.map((p) => ({ leadId: p._id, projectName: p.projectName, jobId: p.jobId, location: p.location })),
  })
})

// Normalises one form row. New app rows send { materialType, quantity, name? } ('Other' needs a
// name); older clients that send { name, quantity } keep working.
const parseRequestedItem = (item, index) => {
  const row = `Material ${index + 1}`
  if (!item || typeof item !== 'object') return { error: `${row}: invalid item` }

  const materialType = String(item.materialType || '').trim()
  let name = String(item.name || '').trim()
  if (materialType) {
    if (!MATERIAL_REQUEST_MATERIAL_TYPES.includes(materialType)) {
      return { error: `${row}: materialType must be one of: ${MATERIAL_REQUEST_MATERIAL_TYPES.join(', ')}` }
    }
    if (materialType === 'Other' && !name) return { error: `${row}: name is required when materialType is Other` }
    if (materialType !== 'Other') name = materialType
  }
  if (!name) return { error: `${row}: materialType is required` }

  const quantity = Number(item.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: `${row}: quantity must be greater than 0` }

  return {
    value: {
      name,
      materialType,
      quantity,
      unit: String(item.unit || '').trim(),
      notes: String(item.notes || '').trim(),
    },
  }
}

const startOfToday = () => new Date(new Date().toDateString())

const MAX_ATTACHMENTS = 20

// Files are uploaded to S3 first (POST /api/upload/presigned-url); the request only stores the link.
const parseAttachments = (attachments) => {
  if (attachments === undefined) return { value: [] }
  if (!Array.isArray(attachments)) return { error: 'attachments must be an array' }
  if (attachments.length > MAX_ATTACHMENTS) return { error: `At most ${MAX_ATTACHMENTS} attachments are allowed` }

  const value = []
  for (const [index, file] of attachments.entries()) {
    const row = `Attachment ${index + 1}`
    const url = String(file?.url || '').trim()
    let parsedUrl
    try { parsedUrl = new URL(url) } catch { parsedUrl = null }
    if (!parsedUrl || !['https:', 'http:'].includes(parsedUrl.protocol)) return { error: `${row}: url must be a valid http(s) link` }

    const fileSize = file.fileSize === undefined ? 0 : Number(file.fileSize)
    if (!Number.isFinite(fileSize) || fileSize < 0) return { error: `${row}: fileSize must be a number of bytes` }

    const name = String(file.name || '').trim() || decodeURIComponent(parsedUrl.pathname.split('/').pop() || '') || 'Attachment'
    value.push({ name, url, fileSize })
  }
  return { value }
}

// POST /material-requests — "Create" on the Create New Material Request form
exports.createMaterialRequest = asyncHandler(async (req, res) => {
  const { leadId, siteLocation, department, requestedItems, requiredBy, priority, remarks } = req.body
  const attachments = parseAttachments(req.body.attachments)
  if (attachments.error) return badRequest(res, attachments.error)
  if (!leadId) return badRequest(res, 'leadId is required')
  if (!mongoose.Types.ObjectId.isValid(leadId)) return badRequest(res, 'Invalid leadId')
  if (!Array.isArray(requestedItems) || !requestedItems.length) {
    return badRequest(res, 'requestedItems is required — add at least one material')
  }
  if (priority !== undefined && !MR_PRIORITIES.includes(priority)) {
    return badRequest(res, `priority must be one of: ${MR_PRIORITIES.join(', ')}`)
  }

  let requiredByDate = null
  if (requiredBy) {
    requiredByDate = new Date(requiredBy)
    if (Number.isNaN(requiredByDate.getTime())) return badRequest(res, 'requiredBy must be a valid date')
    if (requiredByDate < startOfToday()) return badRequest(res, 'requiredBy cannot be in the past')
  }

  const items = []
  for (const [index, item] of requestedItems.entries()) {
    const parsed = parseRequestedItem(item, index)
    if (parsed.error) return badRequest(res, parsed.error)
    items.push(parsed.value)
  }

  const lead = await Lead.findById(leadId).select('location isTerminated').lean()
  if (!lead) return notFound(res, 'Project not found')
  if (lead.isTerminated) return badRequest(res, 'Cannot raise a material request for a terminated project')

  // requestId is count-based; retry on the rare collision from concurrent creates.
  let mr
  for (let attempt = 1; !mr; attempt++) {
    try {
      mr = await MaterialRequest.create({
        requestId: await generateRequestId(),
        leadId,
        siteLocation: String(siteLocation || '').trim() || lead.location || '',
        department,
        source: 'construction',
        requestedBy: req.user._id,
        requestedItems: items,
        requestDate: new Date(),
        requiredBy: requiredByDate,
        priority: priority || 'medium',
        specialInstructions: String(remarks || '').trim(),
        attachments: attachments.value,
      })
    } catch (err) {
      if (err?.code !== 11000 || !err?.keyPattern?.requestId || attempt >= 5) throw err
    }
  }

  const saved = await MaterialRequest.findById(mr._id)
    .populate('leadId', 'projectName jobId location')
    .populate('requestedBy', REQUESTED_BY_FIELDS)
    .lean()

  // Admins approve/reject requests, so let them know a new one is waiting.
  const requiredByText = saved.requiredBy
    ? `, required by ${saved.requiredBy.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
    : ''
  await notificationService.notifyRole('admin', {
    leadId: saved.leadId?._id,
    title: `New material request ${saved.requestId}`,
    body: `${saved.leadId?.projectName || 'Project'} — ${items.length} item(s), priority ${saved.priority}${requiredByText}. Raised by ${req.user?.name || 'construction team'}.`,
    type: 'material_request',
    priority: ['high', 'critical'].includes(saved.priority) ? 'high' : 'medium',
    refId: saved._id,
    refModel: 'MaterialRequest',
  })

  return created(res, { materialRequest: mapRow(saved) }, 'Material request created')
})

exports.updateMaterialRequestStatus = asyncHandler(async (req, res) => {
  const { status, reviewNotes } = req.body
  if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
    return badRequest(res, 'Invalid status')
  }

  const mr = await MaterialRequest.findById(req.params.requestId)
  if (!mr) return notFound(res, 'Material request not found')
  if (mr.status === 'cancelled') return badRequest(res, 'This request was cancelled by the requester')

  mr.status = status
  mr.reviewedBy = req.user._id
  mr.reviewedAt = new Date()
  if (reviewNotes) mr.reviewNotes = reviewNotes
  await mr.save()

  if (mr.requestedBy && ['approved', 'rejected', 'fulfilled'].includes(status)) {
    await notificationService.notify({
      userId: mr.requestedBy,
      leadId: mr.leadId,
      title: `Material request ${status}`,
      body: `Request ${mr.requestId || mr._id} was ${status}${reviewNotes ? `: ${reviewNotes}` : '.'}`,
      type: 'material_request',
      priority: status === 'rejected' ? 'high' : 'medium',
      refId: mr._id,
      refModel: 'MaterialRequest',
    })
  }

  return success(res, { requestId: mr._id, status: mr.status }, 'Material request updated')
})

// POST /material-requests/:requestId/quotations — staff sends a coil-order quotation back to the customer
exports.createOrderQuotation = asyncHandler(async (req, res) => {
  const mr = await MaterialRequest.findById(req.params.requestId).populate('leadId', 'customerId')
  if (!mr) return notFound(res, 'Material request not found')
  if (!mr.leadId?.customerId) return badRequest(res, 'Request has no linked customer')

  const { lineItems, tax = 0, freight = 0, sellerName, sellerAddress, sellerEmail, paymentMethods } = req.body
  if (!Array.isArray(lineItems) || !lineItems.length) return badRequest(res, 'lineItems is required')

  const subtotal = lineItems.reduce((sum, i) => sum + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0), 0)
  const items = lineItems.map((i) => ({
    coilType: i.coilType,
    lengthFeet: i.lengthFeet ?? null,
    quantity: i.quantity,
    color: i.color || '',
    unitPrice: i.unitPrice || 0,
    amount: (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0),
  }))

  const quotation = await OrderQuotation.create({
    quotationNumber: await generateQuotationNumber(),
    orderId: mr._id,
    leadId: mr.leadId._id,
    customerId: mr.leadId.customerId,
    buildingLabel: mr.buildingLabel || '',
    sellerName: sellerName || '',
    sellerAddress: sellerAddress || '',
    sellerEmail: sellerEmail || '',
    lineItems: items,
    subtotal,
    tax,
    freight,
    totalValue: subtotal + Number(tax) + Number(freight),
    paymentMethods: paymentMethods || undefined,
    createdBy: req.user._id,
  })

  return created(res, { quotation }, 'Quotation sent to customer')
})

// POST /material-requests/:requestId/items/:itemId/deliver — marks one coil line item delivered
exports.markOrderItemDelivered = asyncHandler(async (req, res) => {
  const { deliveryId, deliveryReference } = req.body

  const mr = await MaterialRequest.findById(req.params.requestId)
  if (!mr) return notFound(res, 'Material request not found')

  const item = mr.requestedItems.id(req.params.itemId)
  if (!item) return notFound(res, 'Order item not found')

  let reference = deliveryReference || ''
  if (deliveryId) {
    const delivery = await Delivery.findById(deliveryId).select('deliveryNumber').lean()
    if (!delivery) return badRequest(res, 'deliveryId does not match a known delivery')
    reference = reference || delivery.deliveryNumber
    item.deliveryId = deliveryId
  }

  item.deliveryStatus = 'delivered'
  item.deliveryReference = reference
  item.deliveredAt = new Date()

  const allDelivered = mr.requestedItems.every((i) => i.deliveryStatus === 'delivered')
  if (allDelivered) mr.status = 'fulfilled'

  await mr.save()

  return success(res, { requestId: mr._id, itemId: item._id, deliveryStatus: item.deliveryStatus, orderStatus: mr.status }, 'Item marked delivered')
})
