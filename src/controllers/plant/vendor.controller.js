const Vendor = require('../../models/Vendor')
const ShipperRequest = require('../../models/ShipperRequest')
const generateVendorCode = require('../../utils/generateVendorCode')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS, ACTIVE_SHIPPER_REQUEST_STATUSES } = require('../../config/constants')

const formatPickupLocation = (address = {}) => {
  const parts = [address.city, address.state].filter(Boolean)
  if (parts.length) return parts.join(', ')
  return [address.streetAddress, address.postalCode].filter(Boolean).join(', ')
}

const getVendorOrderStatsMap = async (vendorIds) => {
  if (!vendorIds.length) return {}

  const rows = await ShipperRequest.aggregate([
    { $match: { vendorId: { $in: vendorIds } } },
    {
      $group: {
        _id: '$vendorId',
        totalOrders: { $sum: 1 },
        activeOrders: {
          $sum: { $cond: [{ $in: ['$status', ACTIVE_SHIPPER_REQUEST_STATUSES] }, 1, 0] },
        },
        completedOrders: {
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] },
        },
        bidsSubmitted: {
          $sum: { $cond: [{ $ifNull: ['$submittedAt', false] }, 1, 0] },
        },
        bidsSent: { $sum: 1 },
      },
    },
  ])

  return rows.reduce((acc, row) => {
    acc[String(row._id)] = {
      totalOrders: row.totalOrders,
      activeOrders: row.activeOrders,
      completedOrders: row.completedOrders,
      bidsSubmitted: row.bidsSubmitted,
      bidsSent: row.bidsSent,
    }
    return acc
  }, {})
}

const mapVendorListRow = (vendor, stats = {}) => ({
  _id: vendor._id,
  vendorCode: vendor.vendorCode,
  vendorName: vendor.vendorName,
  contactName: vendor.contactName || '',
  email: vendor.email,
  phone: vendor.phone || '',
  materialTypes: vendor.materialTypes || [],
  vendorType: vendor.vendorType,
  status: vendor.status,
  pickupLocation: formatPickupLocation(vendor.address),
  activeOrders: stats.activeOrders || 0,
  totalOrders: stats.totalOrders || 0,
})

const buildVendorListFilter = (query) => {
  const { status, materialType } = query
  const filter = {}

  if (status) filter.status = status
  if (materialType) filter.materialTypes = materialType

  if (query.search?.trim()) {
    const regex = new RegExp(query.search.trim(), 'i')
    filter.$or = [
      { vendorName: regex },
      { contactName: regex },
      { email: regex },
    ]
  }

  return filter
}

const normalizeAddress = (address = {}) => ({
  placeNumber: address.placeNumber?.trim() || '',
  streetAddress: address.streetAddress?.trim() || '',
  landmark: address.landmark?.trim() || '',
  city: address.city?.trim() || '',
  state: address.state?.trim() || '',
  postalCode: address.postalCode?.trim() || '',
  gpsCoordinates: {
    lat: address.gpsCoordinates?.lat ?? null,
    lng: address.gpsCoordinates?.lng ?? null,
  },
})

const normalizeDocuments = (documents = []) =>
  documents
    .filter(doc => doc?.name?.trim() && doc?.url?.trim())
    .map(doc => ({ name: doc.name.trim(), url: doc.url.trim() }))

exports.getVendors = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = buildVendorListFilter(req.query)

  const [vendors, total] = await Promise.all([
    Vendor.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
    Vendor.countDocuments(filter),
  ])

  const statsMap = await getVendorOrderStatsMap(vendors.map(v => v._id))

  return success(res, {
    vendors: vendors.map(v => mapVendorListRow(v, statsMap[String(v._id)])),
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.createVendor = asyncHandler(async (req, res) => {
  const {
    vendorName,
    vendorCode,
    email,
    phone,
    contactName,
    yearsWithCompany,
    serviceCategory,
    vendorType,
    materialTypes,
    address,
    documents,
    internalNotes,
  } = req.body

  const normalizedEmail = email.toLowerCase().trim()
  const exists = await Vendor.findOne({ email: normalizedEmail })
  if (exists) return badRequest(res, 'Email already in use')

  let code = vendorCode?.trim()
  if (code) {
    const codeExists = await Vendor.findOne({ vendorCode: code })
    if (codeExists) return badRequest(res, 'Vendor code already in use')
  } else {
    code = await generateVendorCode()
  }

  const vendor = await Vendor.create({
    vendorCode: code,
    vendorName: vendorName.trim(),
    contactName: contactName?.trim() || '',
    email: normalizedEmail,
    phone: phone?.trim() || '',
    yearsWithCompany: yearsWithCompany ?? null,
    serviceCategory: serviceCategory?.trim() || '',
    vendorType: vendorType || 'other',
    materialTypes: Array.isArray(materialTypes) ? materialTypes : [],
    address: normalizeAddress(address),
    documents: normalizeDocuments(documents),
    internalNotes: internalNotes?.trim() || '',
  })

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.VENDOR_CREATED,
    performedBy: req.user._id,
    metadata: { vendorId: vendor._id, vendorCode: vendor.vendorCode, vendorName: vendor.vendorName },
  })

  return created(res, { vendor })
})

exports.getVendorDetail = asyncHandler(async (req, res) => {
  const { vendorId } = req.params

  const vendor = await Vendor.findById(vendorId).lean()
  if (!vendor) return notFound(res, 'Vendor not found')

  const [statsMap, orderHistory] = await Promise.all([
    getVendorOrderStatsMap([vendor._id]),
    ShipperRequest.find({ vendorId, status: 'approved' })
      .populate('leadId', 'projectName jobId quoteValue')
      .sort({ reviewedAt: -1, updatedAt: -1 })
      .lean(),
  ])

  const stats = statsMap[String(vendor._id)] || {
    totalOrders: 0,
    activeOrders: 0,
    completedOrders: 0,
    bidsSubmitted: 0,
    bidsSent: 0,
  }

  return success(res, {
    vendor: {
      ...vendor,
      pickupLocation: formatPickupLocation(vendor.address),
    },
    stats: {
      totalOrders: stats.totalOrders,
      completedDeliveries: stats.completedOrders,
      activeOrders: stats.activeOrders,
      bidsSubmitted: stats.bidsSubmitted,
      bidsSent: stats.bidsSent,
    },
    orderHistory: orderHistory.map(order => ({
      _id: order._id,
      projectName: order.leadId?.projectName || '',
      jobId: order.leadId?.jobId || '',
      quoteValue: order.quoteValue ?? order.leadId?.quoteValue ?? 0,
      status: order.status,
      submittedAt: order.submittedAt,
      reviewedAt: order.reviewedAt,
      sentAt: order.sentAt,
    })),
  })
})

exports.updateVendor = asyncHandler(async (req, res) => {
  const { vendorId } = req.params
  const vendor = await Vendor.findById(vendorId)
  if (!vendor) return notFound(res, 'Vendor not found')

  const {
    vendorName,
    vendorCode,
    email,
    phone,
    contactName,
    yearsWithCompany,
    serviceCategory,
    vendorType,
    materialTypes,
    address,
    documents,
    internalNotes,
    status,
  } = req.body

  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase().trim()
    const emailTaken = await Vendor.findOne({ email: normalizedEmail, _id: { $ne: vendorId } })
    if (emailTaken) return badRequest(res, 'Email already in use')
    vendor.email = normalizedEmail
  }

  if (vendorCode !== undefined) {
    const code = vendorCode.trim()
    const codeTaken = await Vendor.findOne({ vendorCode: code, _id: { $ne: vendorId } })
    if (codeTaken) return badRequest(res, 'Vendor code already in use')
    vendor.vendorCode = code
  }

  if (vendorName !== undefined) vendor.vendorName = vendorName.trim()
  if (contactName !== undefined) vendor.contactName = contactName.trim()
  if (phone !== undefined) vendor.phone = phone.trim()
  if (yearsWithCompany !== undefined) vendor.yearsWithCompany = yearsWithCompany
  if (serviceCategory !== undefined) vendor.serviceCategory = serviceCategory.trim()
  if (vendorType !== undefined) vendor.vendorType = vendorType
  if (materialTypes !== undefined) vendor.materialTypes = materialTypes
  if (address !== undefined) vendor.address = normalizeAddress(address)
  if (documents !== undefined) vendor.documents = normalizeDocuments(documents)
  if (internalNotes !== undefined) vendor.internalNotes = internalNotes.trim()
  if (status !== undefined) vendor.status = status

  await vendor.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.VENDOR_UPDATED,
    performedBy: req.user._id,
    metadata: { vendorId: vendor._id, vendorCode: vendor.vendorCode },
  })

  return success(res, { vendor })
})

exports.toggleVendorStatus = asyncHandler(async (req, res) => {
  const { vendorId } = req.params
  const vendor = await Vendor.findById(vendorId)
  if (!vendor) return notFound(res, 'Vendor not found')

  vendor.status = vendor.status === 'active' ? 'inactive' : 'active'
  await vendor.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.VENDOR_UPDATED,
    performedBy: req.user._id,
    metadata: { vendorId: vendor._id, status: vendor.status },
  })

  return success(res, { vendor: { _id: vendor._id, status: vendor.status } })
})
