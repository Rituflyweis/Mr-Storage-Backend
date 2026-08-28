const FreightCarrier = require('../../models/FreightCarrier')
const FreightBid = require('../../models/FreightBid')
const generateCarrierCode = require('../../utils/generateCarrierCode')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const {
  AUDIT_ACTIONS,
  ACTIVE_FREIGHT_BID_STATUSES,
} = require('../../config/constants')

const normalizeAddress = (address = {}) => ({
  country: address.country?.trim() || '',
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

const normalizeFleetEquipment = (fleetEquipment = []) =>
  fleetEquipment
    .filter(item => item?.equipmentName?.trim())
    .map(item => ({
      equipmentName: item.equipmentName.trim(),
      quantity: Math.max(Number(item.quantity) || 0, 0),
    }))

const normalizeFleetCapacity = (fleetCapacity = {}) => ({
  totalVehicleCount: fleetCapacity.totalVehicleCount ?? null,
  maximumLoadCapacity: fleetCapacity.maximumLoadCapacity ?? null,
  averageFleetAge: fleetCapacity.averageFleetAge ?? null,
})

const getEquipmentTypes = (fleetEquipment = []) =>
  fleetEquipment.map(item => item.equipmentName).filter(Boolean)

const calcBidWinRate = (awardedCount, submittedCount) => {
  if (!submittedCount) return 0
  return Math.round((awardedCount / submittedCount) * 1000) / 10
}

const getCarrierBidStatsMap = async (carrierIds) => {
  if (!carrierIds.length) return {}

  const rows = await FreightBid.aggregate([
    { $match: { carrierId: { $in: carrierIds } } },
    {
      $group: {
        _id: '$carrierId',
        totalBids: { $sum: 1 },
        activeBids: {
          $sum: { $cond: [{ $in: ['$status', ACTIVE_FREIGHT_BID_STATUSES] }, 1, 0] },
        },
        awardedBidCount: {
          $sum: { $cond: [{ $eq: ['$status', 'selected'] }, 1, 0] },
        },
        awardedAmount: {
          $sum: { $cond: [{ $eq: ['$status', 'selected'] }, '$quotedAmount', 0] },
        },
        submittedBidCount: {
          $sum: { $cond: [{ $ifNull: ['$submittedAt', false] }, 1, 0] },
        },
        avgBid: { $avg: '$quotedAmount' },
      },
    },
  ])

  return rows.reduce((acc, row) => {
    acc[String(row._id)] = {
      totalBids: row.totalBids,
      activeBids: row.activeBids,
      awardedBidCount: row.awardedBidCount,
      awardedAmount: row.awardedAmount || 0,
      bidWinRate: calcBidWinRate(row.awardedBidCount, row.submittedBidCount),
      avgBid: row.avgBid ? Math.round(row.avgBid * 100) / 100 : 0,
    }
    return acc
  }, {})
}

const mapCarrierListRow = (carrier, stats = {}) => ({
  _id: carrier._id,
  carrierCode: carrier.carrierCode,
  carrierName: carrier.carrierName,
  contactName: carrier.contactName || '',
  email: carrier.email,
  phone: carrier.phone || '',
  serviceType: carrier.serviceType || '',
  serviceArea: carrier.serviceArea || '',
  equipmentTypes: getEquipmentTypes(carrier.fleetEquipment),
  status: carrier.status,
  activeBids: stats.activeBids || 0,
  totalBids: stats.totalBids || 0,
  awardedBidCount: stats.awardedBidCount || 0,
  awardedAmount: stats.awardedAmount || 0,
  bidWinRate: stats.bidWinRate || 0,
  avgBid: stats.avgBid || 0,
})

// FreightCarrier has no month or material field of its own — "month" scopes to carriers with
// bid activity in that month, and "material" scopes to carriers who've hauled that material,
// both resolved via FreightBid -> Delivery (the same cross-collection pattern used for the
// all-deliveries vendor/internal-owner filters).
const buildCarrierListFilter = async (query) => {
  const { status, serviceType, serviceArea, equipmentType, month, year, materialType } = query
  const filter = {}

  if (status) filter.status = status
  if (serviceType) filter.serviceType = serviceType.trim()
  if (serviceArea) filter.serviceArea = serviceArea.trim()
  if (equipmentType) {
    filter.fleetEquipment = {
      $elemMatch: { equipmentName: equipmentType.trim() },
    }
  }

  if (query.search?.trim()) {
    const regex = new RegExp(query.search.trim(), 'i')
    filter.$or = [
      { carrierName: regex },
      { contactName: regex },
      { email: regex },
    ]
  }

  if ((month && year) || materialType) {
    const Delivery = require('../../models/Delivery')
    const bidFilter = {}

    if (month && year) {
      const monthStart = new Date(Number(year), Number(month) - 1, 1)
      const monthEnd = new Date(Number(year), Number(month), 1)
      bidFilter.createdAt = { $gte: monthStart, $lt: monthEnd }
    }

    if (materialType) {
      const deliveries = await Delivery.find({ materialType }).select('_id').lean()
      bidFilter.deliveryId = { $in: deliveries.map((d) => d._id) }
    }

    const bids = await FreightBid.find(bidFilter).select('carrierId').lean()
    filter._id = { $in: [...new Set(bids.map((b) => String(b.carrierId)))] }
  }

  return filter
}

const calcAvgResponseHours = (bids = []) => {
  const durations = bids
    .filter(bid => bid.sentAt && bid.submittedAt)
    .map(bid => (new Date(bid.submittedAt) - new Date(bid.sentAt)) / (1000 * 60 * 60))

  if (!durations.length) return null
  const avg = durations.reduce((sum, hours) => sum + hours, 0) / durations.length
  return Math.round(avg * 10) / 10
}

exports.getCarriers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = await buildCarrierListFilter(req.query)

  const [carriers, total] = await Promise.all([
    FreightCarrier.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
    FreightCarrier.countDocuments(filter),
  ])

  const statsMap = await getCarrierBidStatsMap(carriers.map(c => c._id))

  return success(res, {
    carriers: carriers.map(c => mapCarrierListRow(c, statsMap[String(c._id)])),
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.createCarrier = asyncHandler(async (req, res) => {
  const {
    carrierName,
    carrierCode,
    email,
    phone,
    contactName,
    serviceType,
    serviceArea,
    address,
    fleetEquipment,
    fleetCapacity,
    documents,
    internalNotes,
  } = req.body

  const normalizedEmail = email.toLowerCase().trim()
  const exists = await FreightCarrier.findOne({ email: normalizedEmail })
  if (exists) return badRequest(res, 'Email already in use')

  let code = carrierCode?.trim()
  if (code) {
    const codeExists = await FreightCarrier.findOne({ carrierCode: code })
    if (codeExists) return badRequest(res, 'Carrier code already in use')
  } else {
    code = await generateCarrierCode()
  }

  const carrier = await FreightCarrier.create({
    carrierCode: code,
    carrierName: carrierName.trim(),
    contactName: contactName?.trim() || '',
    email: normalizedEmail,
    phone: phone?.trim() || '',
    serviceType: serviceType?.trim() || '',
    serviceArea: serviceArea?.trim() || '',
    address: normalizeAddress(address),
    fleetEquipment: normalizeFleetEquipment(fleetEquipment),
    fleetCapacity: normalizeFleetCapacity(fleetCapacity),
    documents: normalizeDocuments(documents),
    internalNotes: internalNotes?.trim() || '',
  })

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.CARRIER_CREATED,
    performedBy: req.user._id,
    metadata: { carrierId: carrier._id, carrierCode: carrier.carrierCode, carrierName: carrier.carrierName },
  })

  return created(res, { carrier })
})

exports.getCarrierDetail = asyncHandler(async (req, res) => {
  const { carrierId } = req.params

  const carrier = await FreightCarrier.findById(carrierId).lean()
  if (!carrier) return notFound(res, 'Carrier not found')

  const bids = await FreightBid.find({ carrierId })
    .populate({
      path: 'deliveryId',
      select: 'deliveryNumber status pickupLocation deliveryLocation leadId',
      populate: { path: 'leadId', select: 'projectName jobId' },
    })
    .sort({ updatedAt: -1 })
    .lean()

  const statsMap = await getCarrierBidStatsMap([carrier._id])
  const stats = statsMap[String(carrier._id)] || {
    totalBids: 0,
    activeBids: 0,
    awardedBidCount: 0,
    awardedAmount: 0,
    bidWinRate: 0,
    avgBid: 0,
  }

  const awardedBids = bids.filter(bid => bid.status === 'selected')
  const lastAwardedDate = awardedBids.reduce((latest, bid) => {
    const date = bid.selectedAt || bid.updatedAt
    if (!date) return latest
    if (!latest || new Date(date) > new Date(latest)) return date
    return latest
  }, null)

  const assignedProjectsMap = new Map()
  for (const bid of awardedBids) {
    const lead = bid.deliveryId?.leadId
    const leadId = lead?._id || lead
    if (!leadId) continue
    const key = String(leadId)
    if (!assignedProjectsMap.has(key)) {
      assignedProjectsMap.set(key, {
        _id: leadId,
        projectName: lead?.projectName || '',
        jobId: lead?.jobId || '',
        deliveryCount: 0,
        lastAwardedAt: null,
      })
    }
    const entry = assignedProjectsMap.get(key)
    entry.deliveryCount += 1
    const awardedAt = bid.selectedAt || bid.updatedAt
    if (awardedAt && (!entry.lastAwardedAt || new Date(awardedAt) > new Date(entry.lastAwardedAt))) {
      entry.lastAwardedAt = awardedAt
    }
  }
  const assignedProjects = [...assignedProjectsMap.values()].sort(
    (a, b) => new Date(b.lastAwardedAt || 0) - new Date(a.lastAwardedAt || 0)
  )

  const freightHistory = bids.map(bid => ({
    _id: bid._id,
    deliveryNumber: bid.deliveryId?.deliveryNumber || '',
    projectName: bid.deliveryId?.leadId?.projectName || '',
    jobId: bid.deliveryId?.leadId?.jobId || '',
    status: bid.status,
    quotedAmount: bid.quotedAmount,
    currency: bid.currency,
    sentAt: bid.sentAt,
    submittedAt: bid.submittedAt,
    selectedAt: bid.selectedAt,
    pickupLocation: bid.deliveryId?.pickupLocation || '',
    deliveryLocation: bid.deliveryId?.deliveryLocation || '',
  }))

  return success(res, {
    carrier: {
      ...carrier,
      equipmentTypes: getEquipmentTypes(carrier.fleetEquipment),
    },
    stats: {
      totalBids: stats.totalBids,
      activeBids: stats.activeBids,
      awardedBidCount: stats.awardedBidCount,
      awardedAmount: stats.awardedAmount,
      bidWinRate: stats.bidWinRate,
      avgBid: stats.avgBid,
      lastAwardedDate,
      avgResponseTimeHours: calcAvgResponseHours(bids),
      assignedProjects: assignedProjects.length,
    },
    assignedProjects,
    freightHistory,
  })
})

exports.updateCarrier = asyncHandler(async (req, res) => {
  const { carrierId } = req.params
  const carrier = await FreightCarrier.findById(carrierId)
  if (!carrier) return notFound(res, 'Carrier not found')

  const {
    carrierName,
    carrierCode,
    email,
    phone,
    contactName,
    serviceType,
    serviceArea,
    address,
    fleetEquipment,
    fleetCapacity,
    documents,
    internalNotes,
    status,
  } = req.body

  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase().trim()
    const emailTaken = await FreightCarrier.findOne({ email: normalizedEmail, _id: { $ne: carrierId } })
    if (emailTaken) return badRequest(res, 'Email already in use')
    carrier.email = normalizedEmail
  }

  if (carrierCode !== undefined) {
    const code = carrierCode.trim()
    const codeTaken = await FreightCarrier.findOne({ carrierCode: code, _id: { $ne: carrierId } })
    if (codeTaken) return badRequest(res, 'Carrier code already in use')
    carrier.carrierCode = code
  }

  if (carrierName !== undefined) carrier.carrierName = carrierName.trim()
  if (contactName !== undefined) carrier.contactName = contactName.trim()
  if (phone !== undefined) carrier.phone = phone.trim()
  if (serviceType !== undefined) carrier.serviceType = serviceType.trim()
  if (serviceArea !== undefined) carrier.serviceArea = serviceArea.trim()
  if (address !== undefined) carrier.address = normalizeAddress(address)
  if (fleetEquipment !== undefined) carrier.fleetEquipment = normalizeFleetEquipment(fleetEquipment)
  if (fleetCapacity !== undefined) carrier.fleetCapacity = normalizeFleetCapacity(fleetCapacity)
  if (documents !== undefined) carrier.documents = normalizeDocuments(documents)
  if (internalNotes !== undefined) carrier.internalNotes = internalNotes.trim()
  if (status !== undefined) carrier.status = status

  await carrier.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.CARRIER_UPDATED,
    performedBy: req.user._id,
    metadata: { carrierId: carrier._id, carrierCode: carrier.carrierCode },
  })

  return success(res, { carrier })
})

exports.toggleCarrierStatus = asyncHandler(async (req, res) => {
  const { carrierId } = req.params
  const carrier = await FreightCarrier.findById(carrierId)
  if (!carrier) return notFound(res, 'Carrier not found')

  carrier.status = carrier.status === 'active' ? 'inactive' : 'active'
  await carrier.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.CARRIER_UPDATED,
    performedBy: req.user._id,
    metadata: { carrierId: carrier._id, status: carrier.status },
  })

  return success(res, { carrier: { _id: carrier._id, status: carrier.status } })
})
