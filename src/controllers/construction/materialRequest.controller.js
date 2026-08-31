const MaterialRequest = require('../../models/MaterialRequest')
const { MR_STATUSES, MR_PRIORITIES } = require('../../models/MaterialRequest')
const OrderQuotation = require('../../models/OrderQuotation')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const notificationService = require('../../services/notification.service')

const generateQuotationNumber = async () => {
  const count = await OrderQuotation.countDocuments({})
  return `INV/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`
}

const generateRequestId = async () => {
  const count = await MaterialRequest.countDocuments({})
  return `MR-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`
}

const mapRow = (mr) => ({
  requestId: mr.requestId,
  _id: mr._id,
  project: mr.leadId
    ? { leadId: mr.leadId._id, projectName: mr.leadId.projectName, jobId: mr.leadId.jobId, location: mr.leadId.location }
    : null,
  siteLocation: mr.siteLocation,
  department: mr.department,
  requestedBy: mr.requestedBy ? { userId: mr.requestedBy._id, name: mr.requestedBy.name } : null,
  requestedItems: mr.requestedItems,
  itemCount: mr.requestedItems?.length || 0,
  requestDate: mr.requestDate,
  requiredBy: mr.requiredBy,
  priority: mr.priority,
  status: mr.status,
  totalAmount: mr.totalAmount,
})

exports.getMaterialRequests = asyncHandler(async (req, res) => {
  const { leadId, department, status, requestedBy, priority, siteLocation, search, dateFrom, dateTo, page = 1, limit = 20 } = req.query

  const filter = {}
  if (leadId) filter.leadId = leadId
  if (department) filter.department = department
  if (status) filter.status = status
  if (requestedBy) filter.requestedBy = requestedBy
  if (priority) filter.priority = priority
  if (siteLocation) filter.siteLocation = siteLocation
  if (search?.trim()) filter.requestId = { $regex: search.trim(), $options: 'i' }
  if (dateFrom || dateTo) {
    filter.requestDate = {}
    if (dateFrom) filter.requestDate.$gte = new Date(dateFrom)
    if (dateTo) filter.requestDate.$lte = new Date(dateTo)
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [rows, total] = await Promise.all([
    MaterialRequest.find(filter)
      .populate('leadId', 'projectName jobId location')
      .populate('requestedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    MaterialRequest.countDocuments(filter),
  ])

  const stats = {
    totalRequests: await MaterialRequest.countDocuments({}),
    pending: await MaterialRequest.countDocuments({ status: 'pending' }),
    approved: await MaterialRequest.countDocuments({ status: 'approved' }),
    rejected: await MaterialRequest.countDocuments({ status: 'rejected' }),
  }

  return success(res, { materialRequests: rows.map(mapRow), total, stats })
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

exports.getMaterialRequest = asyncHandler(async (req, res) => {
  const mr = await MaterialRequest.findById(req.params.requestId)
    .populate('leadId', 'projectName jobId location')
    .populate('requestedBy', 'name email')
    .lean()
  if (!mr) return notFound(res, 'Material request not found')
  return success(res, { materialRequest: mapRow(mr) })
})

exports.createMaterialRequest = asyncHandler(async (req, res) => {
  const { leadId, siteLocation, department, requestedItems, requiredBy, priority } = req.body
  if (!leadId) return badRequest(res, 'leadId is required')
  if (!Array.isArray(requestedItems) || !requestedItems.length) {
    return badRequest(res, 'requestedItems is required')
  }

  const mr = await MaterialRequest.create({
    requestId: await generateRequestId(),
    leadId,
    siteLocation,
    department,
    requestedBy: req.user._id,
    requestedItems,
    requiredBy,
    priority,
  })

  return created(res, { materialRequest: mr }, 'Material request created')
})

exports.updateMaterialRequestStatus = asyncHandler(async (req, res) => {
  const { status, reviewNotes } = req.body
  if (!['pending', 'approved', 'rejected', 'fulfilled'].includes(status)) {
    return badRequest(res, 'Invalid status')
  }

  const mr = await MaterialRequest.findById(req.params.requestId)
  if (!mr) return notFound(res, 'Material request not found')

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
