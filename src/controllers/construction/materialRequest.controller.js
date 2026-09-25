const MaterialRequest = require('../../models/MaterialRequest')
const { MR_STATUSES, MR_PRIORITIES } = require('../../models/MaterialRequest')
const OrderQuotation = require('../../models/OrderQuotation')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const ExcelJS = require('exceljs')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const notificationService = require('../../services/notification.service')
const generateMaterialRequestId = require('../../utils/generateMaterialRequestId')
const generateOrderQuotationNumber = require('../../utils/generateOrderQuotationNumber')

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

const buildMaterialRequestFilter = (query) => {
  const {
    leadId,
    projectId,
    department,
    status,
    requestedBy,
    priority,
    siteLocation,
    search,
    dateFrom,
    dateTo,
    fromDate,
    toDate,
  } = query

  const filter = {}
  const project = leadId || projectId
  if (project) filter.leadId = project
  if (department) filter.department = department
  if (status && status !== 'All') filter.status = status
  if (requestedBy && requestedBy !== 'All') filter.requestedBy = requestedBy
  if (priority && priority !== 'All') filter.priority = priority
  if (siteLocation) filter.siteLocation = siteLocation
  if (search?.trim()) filter.requestId = { $regex: search.trim(), $options: 'i' }

  const start = dateFrom || fromDate
  const end = dateTo || toDate
  if (start || end) {
    filter.requestDate = {}
    if (start) filter.requestDate.$gte = new Date(start)
    if (end) {
      const endDate = new Date(end)
      if (!String(end).includes('T')) endDate.setHours(23, 59, 59, 999)
      filter.requestDate.$lte = endDate
    }
  }

  return filter
}

const formatItemsSummary = (items = []) => {
  if (!items.length) return ''
  const names = items.map((i) => i.name).filter(Boolean)
  const unique = [...new Set(names)]
  const label = unique.slice(0, 3).join(', ')
  const more = unique.length > 3 ? ` +${unique.length - 3}` : ''
  return `${items.length} Item${items.length === 1 ? '' : 's'}${label ? `, ${label}${more}` : ''}`
}

const loadMaterialRequestsForExport = async (query) => {
  const filter = buildMaterialRequestFilter(query)
  return MaterialRequest.find(filter)
    .populate('leadId', 'projectName jobId location')
    .populate('requestedBy', 'name email')
    .sort({ createdAt: -1 })
    .lean()
}

const toExportRow = (mr) => {
  const projectName = mr.leadId?.projectName || ''
  const jobId = mr.leadId?.jobId || ''
  const site = mr.siteLocation || mr.leadId?.location || ''
  return {
    requestId: mr.requestId || String(mr._id),
    projectSite: [projectName || jobId, site].filter(Boolean).join(', '),
    jobId,
    department: mr.department || '',
    items: formatItemsSummary(mr.requestedItems),
    itemCount: mr.requestedItems?.length || 0,
    requestDate: mr.requestDate ? new Date(mr.requestDate).toISOString() : '',
    requiredBy: mr.requiredBy ? new Date(mr.requiredBy).toISOString().slice(0, 10) : '',
    status: mr.status || '',
    priority: mr.priority || '',
    requestedBy: mr.requestedBy?.name || '',
    totalAmount: mr.totalAmount ?? 0,
  }
}

exports.getMaterialRequests = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const filter = buildMaterialRequestFilter(req.query)

  const skip = (Number(page) - 1) * Number(limit)
  const [rows, total, pending, approved, rejected, totalRequests] = await Promise.all([
    MaterialRequest.find(filter)
      .populate('leadId', 'projectName jobId location')
      .populate('requestedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    MaterialRequest.countDocuments(filter),
    MaterialRequest.countDocuments({ status: 'pending' }),
    MaterialRequest.countDocuments({ status: 'approved' }),
    MaterialRequest.countDocuments({ status: 'rejected' }),
    MaterialRequest.countDocuments({}),
  ])

  return success(res, {
    materialRequests: rows.map(mapRow),
    total,
    stats: { totalRequests, pending, approved, rejected },
  })
})

// GET /material-requests/export — Excel (default) or CSV; same filters as list
exports.exportMaterialRequests = asyncHandler(async (req, res) => {
  const path = String(req.path || req.originalUrl || '')
  let format = String(req.query.format || '').toLowerCase()
  if (!format) {
    format = path.includes('/export/csv') || path.endsWith('/csv') ? 'csv' : 'excel'
  }
  const rows = (await loadMaterialRequestsForExport(req.query)).map(toExportRow)

  if (format === 'csv') {
    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = [
      'Request ID',
      'Project / Site',
      'Job ID',
      'Department',
      'Items',
      'Item Count',
      'Request Date',
      'Required By',
      'Status',
      'Priority',
      'Requested By',
      'Total Amount',
    ]
    const lines = [header.map(escapeCsv).join(',')]
    for (const r of rows) {
      lines.push(
        [
          r.requestId,
          r.projectSite,
          r.jobId,
          r.department,
          r.items,
          r.itemCount,
          r.requestDate,
          r.requiredBy,
          r.status,
          r.priority,
          r.requestedBy,
          r.totalAmount,
        ]
          .map(escapeCsv)
          .join(',')
      )
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="material-requests.csv"')
    return res.send(lines.join('\n'))
  }

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Material Requests')
  sheet.columns = [
    { header: 'Request ID', key: 'requestId', width: 18 },
    { header: 'Project / Site', key: 'projectSite', width: 36 },
    { header: 'Job ID', key: 'jobId', width: 12 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Items', key: 'items', width: 32 },
    { header: 'Item Count', key: 'itemCount', width: 12 },
    { header: 'Request Date', key: 'requestDate', width: 22 },
    { header: 'Required By', key: 'requiredBy', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Requested By', key: 'requestedBy', width: 20 },
    { header: 'Total Amount', key: 'totalAmount', width: 14 },
  ]
  sheet.getRow(1).font = { bold: true }
  for (const r of rows) sheet.addRow(r)

  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
  res.setHeader('Content-Disposition', 'attachment; filename="material-requests.xlsx"')
  return res.send(Buffer.from(buffer))
})

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
    requestId: await generateMaterialRequestId(),
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
    quotationNumber: await generateOrderQuotationNumber(),
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

  return success(
    res,
    {
      requestId: mr._id,
      itemId: item._id,
      deliveryStatus: item.deliveryStatus,
      orderStatus: mr.status,
    },
    'Item marked delivered'
  )
})
