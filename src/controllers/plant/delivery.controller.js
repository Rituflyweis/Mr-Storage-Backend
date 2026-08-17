const crypto = require('crypto')
const mongoose = require('mongoose')
const Delivery = require('../../models/Delivery')
const BundlePlan = require('../../models/BundlePlan')
const Bundle = require('../../models/Bundle')
const PackingListPlan = require('../../models/PackingListPlan')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Lead = require('../../models/Lead')
const POOrder = require('../../models/POOrder')
const ShipperRequest = require('../../models/ShipperRequest')
const Vendor = require('../../models/Vendor')
const auditService = require('../../services/audit.service')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')
const { sendFreightBidRequestEmail } = require('../../services/email/mailer')
const {
  computeFreightEnvelopeDimensions,
  loadFreightLoadDetailsByLeadId,
  loadFreightLoadDetailsByBundlePlanId,
} = require('../../services/plant/freightLoadDetails.service')
const { CLIENT_URL } = require('../../config/env')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { resolveLeadByProjectRef } = require('../../utils/projectRef')
const { SHIPPER_REQUEST_LATEST_FIRST_SORT } = require('../../utils/shipperRequestSort')
const {
  mapPlantFreightBidRow,
  mapSelectedFreightBidDetails,
} = require('../../utils/freightBidDisplay')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const DELIVERY_STATUS_TRANSITIONS = {
  draft: ['scheduled', 'cancelled'],
  bidding_sent: ['scheduled', 'cancelled'],
  carrier_selected: ['scheduled', 'confirmed', 'in_transit', 'delayed', 'cancelled'],
  scheduled: ['confirmed', 'in_transit', 'delayed', 'cancelled'],
  confirmed: ['in_transit', 'delayed', 'cancelled'],
  in_transit: ['staged', 'delivered', 'delayed', 'cancelled'],
  delayed: ['scheduled', 'confirmed', 'in_transit', 'delivered', 'cancelled'],
  staged: ['delivered', 'partial_received', 'received', 'cancelled'],
  delivered: ['partial_received', 'received'],
  partial_received: ['received'],
}

const DELIVERY_RESCHEDULE_BLOCKED_STATUSES = new Set(['cancelled', 'delivered'])
const DELIVERY_EDIT_BLOCKED_STATUSES = new Set(['cancelled', 'delivered'])
const DELIVERY_POST_AWARD_STATUSES = new Set([
  'carrier_selected',
  'scheduled',
  'confirmed',
  'in_transit',
  'delayed',
])
const DELIVERY_POST_AWARD_LOCKED_BODY_KEYS = new Set([
  'weight',
  'dimensions',
  'metalType',
  'packageCount',
  'bidDeadline',
  'loadDescription',
])
const DELIVERY_EDIT_BODY_KEYS = [
  'description',
  'loadDescription',
  'weight',
  'dimensions',
  'metalType',
  'packageCount',
  'loadingEquipment',
  'bidDeadline',
  'documentUrl',
  'pickupLocation',
  'pickupLocationData',
  'deliveryLocation',
  'deliveryLocationData',
  'pickupDate',
  'pickupTime',
  'deliveryDate',
  'deliveryTime',
  'timeWindowStart',
  'timeWindowEnd',
  'timings',
  'receivingPoc',
  'pickupContactPhone',
  'specialRequirements',
  'additionalNotes',
]

const formatDeliveryTimeWindow = (start = '', end = '') => {
  const s = String(start || '').trim()
  const e = String(end || '').trim()
  if (s && e) return `${s} - ${e}`
  return s || e || ''
}

const makeDeliveryStatusHistory = (delivery) => {
  const rows = Array.isArray(delivery?.statusHistory) ? [...delivery.statusHistory] : []
  if (!rows.length && delivery?.status) {
    rows.push({
      status: delivery.status,
      changedAt: delivery.createdAt || new Date(),
    })
  }
  return rows
    .map((row) => ({
      status: row.status,
      changedAt: row.changedAt,
    }))
    .sort((a, b) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime())
}

const getAssignedLeadIds = (req) => getScopedLeadIds(req)

const getNextDeliveryNumber = async () => {
  const [latest] = await Delivery.aggregate([
    { $match: { deliveryNumber: { $regex: /^DEL-\d+$/ } } },
    {
      $project: {
        n: {
          $toInt: {
            $arrayElemAt: [{ $split: ['$deliveryNumber', '-'] }, 1],
          },
        },
      },
    },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ])

  const next = (latest?.n || 0) + 1
  return `DEL-${String(next).padStart(4, '0')}`
}

const normalizeCoordinates = (coords = {}) => ({
  lat: coords.lat != null ? Number(coords.lat) : null,
  lng: coords.lng != null ? Number(coords.lng) : null,
})

const normalizeLocationData = (location = {}) => ({
  address: String(location.address || '').trim(),
  coordinates: normalizeCoordinates(location.coordinates || {}),
})

const buildDeliveryFieldsFromBody = (body = {}) => {
  const fields = {}

  if (body.description !== undefined) {
    fields.description = String(body.description || '').trim()
  }
  if (body.loadDescription !== undefined) {
    fields.loadDescription = String(body.loadDescription || '').trim()
  }
  if (body.weight !== undefined) {
    fields.loadWeight = body.weight != null ? Number(body.weight) : null
  }
  if (body.dimensions !== undefined) {
    fields.dimensions = {
      lengthFeet: body.dimensions?.lengthFeet != null ? Number(body.dimensions.lengthFeet) : null,
      widthFeet: body.dimensions?.widthFeet != null ? Number(body.dimensions.widthFeet) : null,
      heightFeet: body.dimensions?.heightFeet != null ? Number(body.dimensions.heightFeet) : null,
    }
  }
  if (body.metalType !== undefined) {
    fields.materialType = String(body.metalType || '').trim()
  }
  if (body.packageCount !== undefined) {
    fields.packageCount = body.packageCount != null ? Number(body.packageCount) : null
  }
  if (body.loadingEquipment !== undefined) {
    fields.loadingEquipment = Array.isArray(body.loadingEquipment)
      ? body.loadingEquipment.map((v) => String(v || '').trim()).filter(Boolean)
      : []
  }
  if (body.bidDeadline !== undefined) {
    fields.bidDeadline = body.bidDeadline ? new Date(body.bidDeadline) : null
  }
  if (body.documentUrl !== undefined) {
    fields.documentUrl = String(body.documentUrl || '').trim()
  }
  if (body.pickupLocation !== undefined) {
    fields.pickupLocation = String(body.pickupLocation || '').trim()
  }
  if (body.pickupLocationData !== undefined) {
    fields.pickupLocationData = normalizeLocationData(body.pickupLocationData || {})
  }
  if (body.deliveryLocation !== undefined) {
    fields.deliveryLocation = String(body.deliveryLocation || '').trim()
  }
  if (body.deliveryLocationData !== undefined) {
    fields.deliveryLocationData = normalizeLocationData(body.deliveryLocationData || {})
  }
  if (body.pickupDate !== undefined) {
    fields.pickupDate = body.pickupDate ? new Date(body.pickupDate) : null
  }
  if (body.pickupTime !== undefined) {
    fields.pickupTime = String(body.pickupTime || '').trim()
  }
  if (body.deliveryDate !== undefined) {
    fields.deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : null
  }
  if (body.deliveryTime !== undefined) {
    fields.deliveryTime = String(body.deliveryTime || '').trim()
  }
  if (body.timeWindowStart !== undefined) {
    fields.timeWindowStart = String(body.timeWindowStart || '').trim()
  }
  if (body.timeWindowEnd !== undefined) {
    fields.timeWindowEnd = String(body.timeWindowEnd || '').trim()
  }
  if (body.timings !== undefined) {
    fields.timings = String(body.timings || '').trim()
  }
  if (body.receivingPoc !== undefined) {
    fields.receivingPoc = String(body.receivingPoc || '').trim()
  }
  if (body.pickupContactPhone !== undefined) {
    fields.pickupContactPhone = String(body.pickupContactPhone || '').trim()
  }
  if (body.specialRequirements !== undefined) {
    fields.specialRequirements = String(body.specialRequirements || '').trim()
  }
  if (body.additionalNotes !== undefined) {
    fields.additionalNotes = String(body.additionalNotes || '').trim()
  }

  if (
    fields.timeWindowStart !== undefined ||
    fields.timeWindowEnd !== undefined
  ) {
    const start = fields.timeWindowStart
    const end = fields.timeWindowEnd
    if (fields.timings === undefined && (start || end)) {
      fields.timings = formatDeliveryTimeWindow(start, end)
    }
    if (fields.deliveryTime === undefined && start) {
      fields.deliveryTime = start
    }
  }

  return fields
}

const toRounded = (value) => {
  if (!Number.isFinite(Number(value))) return null
  return Math.round(Number(value) * 100) / 100
}

const getSubmittedBidAmount = (row) => {
  const rawAmount = row?.quotedAmount
  if (rawAmount == null || rawAmount === '') return null

  const amount = Number(rawAmount)
  if (!Number.isFinite(amount)) return null

  const status = String(row?.status || '').trim().toLowerCase()
  // sent / resubmit_requested never have an active bid amount on the row
  if (status === 'sent' || status === 'resubmit_requested') return null

  return amount
}

const toObjectId = (val) => {
  if (!val) return null
  if (!mongoose.Types.ObjectId.isValid(String(val))) return null
  return new mongoose.Types.ObjectId(String(val))
}

const normalizeDateOnly = (value) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

const startOfDay = (date) => {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

const endOfDay = (date) => {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

const buildDeliverySearchFilter = (search) => {
  const keyword = String(search || '').trim()
  if (!keyword) return null
  const rx = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  return {
    $or: [
      { deliveryNumber: rx },
      { description: rx },
      { loadDescription: rx },
      { pickupLocation: rx },
      { deliveryLocation: rx },
      { deliveryTime: rx },
      { receivingPoc: rx },
      { loadingEquipment: rx },
      { materialType: rx },
    ],
  }
}

const buildDeliveryBaseFilter = ({
  status,
  projectId,
  customerId,
  fromDate,
  toDate,
}) => {
  const filter = {}

  if (status) filter.status = status

  const projectObjectId = toObjectId(projectId)
  if (projectObjectId) filter.leadId = projectObjectId

  const dateFrom = normalizeDateOnly(fromDate)
  const dateTo = normalizeDateOnly(toDate)
  if (dateFrom || dateTo) {
    filter.deliveryDate = {}
    if (dateFrom) filter.deliveryDate.$gte = startOfDay(dateFrom)
    if (dateTo) filter.deliveryDate.$lte = endOfDay(dateTo)
  }

  if (customerId) {
    const customerObjectId = toObjectId(customerId)
    filter._customerId = customerObjectId
  }

  return filter
}

const mapDeliveryListRow = (delivery) => {
  const selectedBid = delivery.selectedCarrierBidId || null
  const carrier = selectedBid?.carrierId || null
  const lead = delivery.leadId || null
  const customer = lead?.customerId || null
  const shipperVendor = delivery._shipperVendor || null

  return {
    _id: delivery._id,
    requestId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    status: delivery.status,
    deliveryTime: delivery.deliveryTime || null,
    project: lead
      ? {
          _id: lead._id,
          jobId: lead.jobId || '',
          projectName: lead.projectName || '',
        }
      : null,
    customer: customer
      ? {
          _id: customer._id,
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
          email: customer.email || '',
        }
      : null,
    shipperVendor: shipperVendor
      ? {
          _id: shipperVendor._id,
          vendorName: shipperVendor.vendorName || '',
          vendorCode: shipperVendor.vendorCode || '',
        }
      : null,
    carrier: carrier
      ? {
          _id: carrier._id,
          carrierName: carrier.carrierName || '',
        }
      : null,
    description: delivery.loadDescription || delivery.description || '',
    pickupLocation: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
    deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
    awardedBidAmount: selectedBid?.quotedAmount ?? null,
    loadSize: {
      weight: delivery.loadWeight ?? null,
      dimensions: delivery.dimensions || {},
      packageCount: delivery.packageCount ?? null,
    },
    poc: {
      receivingPoc: delivery.receivingPoc || '',
      pickupContactPhone: delivery.pickupContactPhone || '',
    },
    equipment: delivery.loadingEquipment || [],
    pickupDate: delivery.pickupDate,
    deliveryDate: delivery.deliveryDate,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  }
}

const SELECTED_DELIVERY_STATUSES = [
  'carrier_selected',
  'scheduled',
  'confirmed',
  'in_transit',
  'delayed',
  'delivered',
]

const CALENDAR_DELIVERY_STATUSES = SELECTED_DELIVERY_STATUSES

const resolveCalendarDate = (delivery) => delivery.deliveryDate || delivery.pickupDate || null

const fetchShipperVendorsByLeadIds = async (leadIds) => {
  if (!leadIds.length) return new Map()
  const requests = await ShipperRequest.find({
    leadId: { $in: leadIds },
    status: { $in: ['approved', 'submitted', 'comparison_completed', 'comparison_failed', 'sent', 'resubmit_requested'] },
  })
    .populate('vendorId', 'vendorName vendorCode')
    .sort({ updatedAt: -1 })
    .lean()

  const map = new Map()
  for (const row of requests) {
    const key = String(row.leadId)
    if (map.has(key)) continue

  // Prefer approved vendor, then latest non-rejected request.
    if (row.status === 'approved' && row.vendorId) {
      map.set(key, row.vendorId)
    }
  }

  for (const row of requests) {
    const key = String(row.leadId)
    if (!map.has(key) && row.vendorId) {
      map.set(key, row.vendorId)
    }
  }

  return map
}

const buildDeliveryStats = (deliveries) => {
  const counts = {
    totalCount: deliveries.length,
    draftCount: 0,
    scheduledCount: 0,
    confirmedCount: 0,
    inTransitCount: 0,
    deliveredCount: 0,
    delayedCount: 0,
    cancelledCount: 0,
  }

  for (const d of deliveries) {
    if (d.status === 'draft') counts.draftCount += 1
    if (d.status === 'scheduled') counts.scheduledCount += 1
    if (d.status === 'confirmed' || d.status === 'carrier_selected') counts.confirmedCount += 1
    if (d.status === 'in_transit') counts.inTransitCount += 1
    if (d.status === 'delivered') counts.deliveredCount += 1
    if (d.status === 'delayed') counts.delayedCount += 1
    if (d.status === 'cancelled') counts.cancelledCount += 1
  }

  return counts
}

const buildFreightAutofill = (bundlePlan, packingListPlan, bundles, loadDetails = {}) => {
  const totalWeight = bundles.reduce((sum, row) => sum + Number(row.totalWeight || 0), 0)
  const envelope = computeFreightEnvelopeDimensions(
    bundles,
    loadDetails.packingLists || []
  )
  const bundleTypes = [...new Set(bundles.map((row) => row.bundleType).filter(Boolean))]

  const loadDescription = `${bundles.length} bundle(s) for bundle plan ${bundlePlan.planNumber || ''}`.trim()

  return {
    loadDescription,
    weight: toRounded(totalWeight),
    dimensions: {
      lengthFeet: toRounded(envelope.lengthFeet),
      widthFeet: toRounded(envelope.widthFeet),
      heightFeet: toRounded(envelope.heightFeet),
    },
    metalType: bundleTypes.join(', '),
    packageCount: packingListPlan?.totalBundles || bundles.length,
    bundlePlan: loadDetails.bundlePlan || null,
    packingListPlan: loadDetails.packingListPlan || null,
    bundles: loadDetails.bundles || [],
    packingLists: loadDetails.packingLists || [],
  }
}

const buildDeliveryBidStats = (bids) => {
  const withAmounts = bids
    .map((row) => ({ ...row, _normalizedBidAmount: getSubmittedBidAmount(row) }))
    .filter((row) => row._normalizedBidAmount != null)
  const sorted = [...withAmounts].sort((a, b) => a._normalizedBidAmount - b._normalizedBidAmount)

  const totalBids = bids.length
  const submittedBids = withAmounts.length
  const averageBid = submittedBids
    ? Math.round((withAmounts.reduce((sum, row) => sum + row._normalizedBidAmount, 0) / submittedBids) * 100) / 100
    : null

  const lowestBid = sorted[0] || null
  const highestBid = sorted[sorted.length - 1] || null
  const awardedBid = withAmounts.find((row) => String(row.status || '').trim().toLowerCase() === 'selected') || null

  let potentialSavings = null
  if (submittedBids > 0) {
    if (awardedBid && highestBid) {
      potentialSavings = Math.max(0, highestBid._normalizedBidAmount - awardedBid._normalizedBidAmount)
    } else if (lowestBid && highestBid) {
      // Pre-award: savings if plant picks lowest vs highest submitted bid
      potentialSavings = Math.max(0, highestBid._normalizedBidAmount - lowestBid._normalizedBidAmount)
    } else {
      potentialSavings = 0
    }
  }

  return {
    totalBids,
    submittedBids,
    averageBid,
    lowestBid,
    highestBid,
    awardedBid,
    potentialSavings,
  }
}

exports.getFreightAutofill = asyncHandler(async (req, res) => {
  const { bundlePlanId } = req.params
  const bundlePlan = await BundlePlan.findById(bundlePlanId).lean()
  if (!bundlePlan) return notFound(res, 'Bundle plan not found')

  const access = await assertPlantProjectAccess(bundlePlan.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const [packingListPlan, bundles, loadDetails] = await Promise.all([
    PackingListPlan.findOne({ bundlePlanId }).lean(),
    Bundle.find({ bundlePlanId }).lean(),
    loadFreightLoadDetailsByBundlePlanId(bundlePlanId),
  ])

  return success(res, buildFreightAutofill(bundlePlan, packingListPlan, bundles, loadDetails))
})

exports.getFreightAutofillByProject = asyncHandler(async (req, res) => {
  const lead = await resolveLeadByProjectRef(req.params.projectId)
  if (!lead) return notFound(res, 'Project not found')

  const access = await assertPlantProjectAccess(lead._id, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const bundlePlan = await BundlePlan.findOne({ leadId: lead._id, status: { $ne: 'cancelled' } })
    .sort({ updatedAt: -1 })
    .lean()
  if (!bundlePlan) return notFound(res, 'No bundle plan found for this project')

  const [packingListPlan, bundles, loadDetails] = await Promise.all([
    PackingListPlan.findOne({ bundlePlanId: bundlePlan._id }).lean(),
    Bundle.find({ bundlePlanId: bundlePlan._id }).lean(),
    loadFreightLoadDetailsByBundlePlanId(bundlePlan._id),
  ])

  return success(res, buildFreightAutofill(bundlePlan, packingListPlan, bundles, loadDetails))
})

exports.createDelivery = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  const access = await assertPlantProjectAccess(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  // Retry on rare deliveryNumber collisions (concurrent creates)
  let delivery
  let deliveryNumber
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    deliveryNumber = await getNextDeliveryNumber()
    try {
      delivery = await Delivery.create({
        leadId,
        deliveryNumber,
        status: 'draft',
        statusHistory: [{ status: 'draft', changedAt: new Date() }],
        ...buildDeliveryFieldsFromBody(req.body),
      })
      break
    } catch (err) {
      const isDupDeliveryNumber =
        err?.code === 11000 &&
        (err?.keyPattern?.deliveryNumber || String(err?.message || '').includes('deliveryNumber'))
      if (!isDupDeliveryNumber || attempt === maxAttempts) throw err
    }
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.DELIVERY_CREATED,
    leadId,
    customerId: access.lead.customerId,
    performedBy: req.user._id,
    metadata: { deliveryId: delivery._id, deliveryNumber: delivery.deliveryNumber },
  })

  return created(res, { delivery }, 'Freight request created')
})

exports.updateDelivery = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const body = req.body || {}

  const hasUpdates = DELIVERY_EDIT_BODY_KEYS.some((key) => body[key] !== undefined)
  if (!hasUpdates) {
    return badRequest(res, 'At least one editable field is required')
  }

  const delivery = await Delivery.findById(deliveryId)
  if (!delivery) return notFound(res, 'Freight request not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (DELIVERY_EDIT_BLOCKED_STATUSES.has(delivery.status)) {
    return badRequest(res, `Cannot edit a delivery with status ${delivery.status}`)
  }

  if (DELIVERY_POST_AWARD_STATUSES.has(delivery.status)) {
    const lockedAttempt = [...DELIVERY_POST_AWARD_LOCKED_BODY_KEYS].filter((key) => body[key] !== undefined)
    if (lockedAttempt.length) {
      return badRequest(
        res,
        `Cannot change load/bid fields after a carrier is selected: ${lockedAttempt.join(', ')}`
      )
    }
  }

  const fields = buildDeliveryFieldsFromBody(body)

  if (
    fields.bidDeadline != null &&
    ['draft', 'bidding_sent'].includes(delivery.status) &&
    (Number.isNaN(fields.bidDeadline.getTime()) || fields.bidDeadline <= new Date())
  ) {
    return badRequest(res, 'bidDeadline must be a valid future date while bidding is open')
  }

  Object.assign(delivery, fields)
  await delivery.save()

  if (
    fields.bidDeadline !== undefined &&
    delivery.status === 'bidding_sent' &&
    fields.bidDeadline
  ) {
    await FreightBid.updateMany(
      {
        deliveryId: delivery._id,
        status: { $in: ['sent', 'resubmit_requested'] },
      },
      { $set: { expiresAt: fields.bidDeadline } }
    )
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.DELIVERY_EDITED,
    leadId: delivery.leadId,
    customerId: access.lead.customerId,
    performedBy: req.user._id,
    metadata: {
      deliveryId: delivery._id,
      deliveryNumber: delivery.deliveryNumber,
      updatedFields: Object.keys(fields),
    },
  })

  const updated = await Delivery.findById(delivery._id)
    .populate(DELIVERY_DETAIL_POPULATE)
    .lean()

  const payload = await buildDeliveryDetailPayload(updated, req.user._id)
  return success(res, payload, 'Freight request updated')
})

exports.getProjectDeliveries = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertPlantProjectAccess(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const deliveries = await Delivery.find({ leadId }).sort({ createdAt: -1 }).lean()
  const deliveryIds = deliveries.map((row) => row._id)
  const [bids, selectedBids] = await Promise.all([
    FreightBid.find({ deliveryId: { $in: deliveryIds } }).lean(),
    FreightBid.find({ _id: { $in: deliveries.map((row) => row.selectedCarrierBidId).filter(Boolean) } })
      .populate('carrierId', 'carrierName')
      .lean(),
  ])
  const selectedMap = new Map(selectedBids.map((row) => [String(row._id), row]))

  const bidsByDelivery = bids.reduce((acc, bid) => {
    const key = String(bid.deliveryId)
    if (!acc[key]) acc[key] = []
    acc[key].push(bid)
    return acc
  }, {})

  const rows = deliveries.map((delivery) => {
    const stats = buildDeliveryBidStats(bidsByDelivery[String(delivery._id)] || [])
    const selectedBid = delivery.selectedCarrierBidId ? selectedMap.get(String(delivery.selectedCarrierBidId)) : null
    const isSelected = Boolean(delivery.selectedCarrierBidId)
    return {
      requestId: delivery._id,
      deliveryId: delivery._id,
      projectName: access.lead.projectName || '',
      description: delivery.loadDescription || delivery.description || '',
      pickupLocation: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
      deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
      pickupDate: delivery.pickupDate,
      deliveryDate: delivery.deliveryDate,
      carrier: selectedBid?.carrierId?.carrierName || null,
      averageBid: stats.averageBid,
      status: delivery.status,
      loadWeight: delivery.loadWeight,
      isSelected,
      hasSelectedCarrier: isSelected,
    }
  })

  const selectedDelivery = deliveries.find((delivery) => {
    return delivery.selectedCarrierBidId &&
      SELECTED_DELIVERY_STATUSES.includes(delivery.status)
  }) || deliveries.find((delivery) => delivery.selectedCarrierBidId) || null

  return success(res, {
    requests: rows,
    total: rows.length,
    selectedDeliveryId: selectedDelivery?._id || null,
  })
})

exports.sendDeliveryBids = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const { carrierIds, bidDeadline } = req.body
  const delivery = await Delivery.findById(deliveryId)
  if (!delivery) return notFound(res, 'Freight request not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (!Array.isArray(carrierIds) || carrierIds.length === 0) {
    return badRequest(res, 'carrierIds array is required')
  }

  const deadline = bidDeadline ? new Date(bidDeadline) : (delivery.bidDeadline || null)
  if (!deadline || Number.isNaN(deadline.getTime()) || deadline <= new Date()) {
    return badRequest(res, 'Valid future bidDeadline is required')
  }

  const uniqueCarrierIds = [...new Set(carrierIds.map((id) => String(id)))]
  const carriers = await FreightCarrier.find({
    _id: { $in: uniqueCarrierIds },
    status: 'active',
  }).select('_id carrierName email').lean()

  if (carriers.length !== uniqueCarrierIds.length) {
    const found = new Set(carriers.map((row) => String(row._id)))
    const invalidCarrierIds = uniqueCarrierIds.filter((id) => !found.has(id))
    return badRequest(res, 'Some carrierIds are invalid or inactive', { invalidCarrierIds })
  }

  const lead = await Lead.findById(delivery.leadId).select('projectName jobId customerId').lean()
  const loadDetails = await loadFreightLoadDetailsByLeadId(delivery.leadId)
  const sent = []
  const failures = []

  for (const carrier of carriers) {
    let bid = await FreightBid.findOne({ deliveryId: delivery._id, carrierId: carrier._id })
    if (!bid) {
      bid = await FreightBid.create({
        deliveryId: delivery._id,
        carrierId: carrier._id,
        token: crypto.randomBytes(32).toString('hex'),
        status: 'sent',
        expiresAt: deadline,
        sentAt: new Date(),
      })
    } else {
      bid.status = 'sent'
      bid.expiresAt = deadline
      bid.sentAt = new Date()
      bid.quotedAmount = null
      bid.carrierNotes = ''
      bid.submittedAt = null
      bid.selectedAt = null
      bid.resubmitNote = ''
      bid.resubmitRequestedAt = null
      bid.resubmitRequestedAmount = null
      bid.resubmitCount = 0
      await bid.save()
    }

    const bidUrl = `${CLIENT_URL}/carrier/${bid.token}`
    try {
      if (carrier.email) {
        await sendFreightBidRequestEmail({
          toEmail: carrier.email,
          carrierName: carrier.carrierName,
          projectName: lead?.projectName || '',
          jobId: lead?.jobId || '',
          deliveryNumber: delivery.deliveryNumber,
          bidDeadline: deadline,
          bidUrl,
          loadDescription: delivery.loadDescription || delivery.description || '',
          loadWeight: delivery.loadWeight,
          pickupLocation: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
          deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
          bundles: loadDetails.bundles,
          packingLists: loadDetails.packingLists,
        })
      }
      sent.push({ bidId: bid._id, carrierId: carrier._id, carrierName: carrier.carrierName, expiresAt: bid.expiresAt })
    } catch (err) {
      failures.push({ carrierId: carrier._id, carrierName: carrier.carrierName, error: err.message })
    }
  }

  delivery.bidDeadline = deadline
  delivery.status = 'bidding_sent'
  delivery.statusHistory = [
    ...makeDeliveryStatusHistory(delivery),
    { status: 'bidding_sent', changedAt: new Date() },
  ]
  await delivery.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.FREIGHT_BIDS_SENT,
    leadId: delivery.leadId,
    customerId: lead?.customerId || null,
    performedBy: req.user._id,
    metadata: { deliveryId: delivery._id, carrierIds: sent.map((row) => row.carrierId), failedCarrierIds: failures.map((row) => row.carrierId) },
  })

  return success(res, { deliveryId: delivery._id, status: delivery.status, bidDeadline: delivery.bidDeadline, sent, failures })
})

exports.getDeliveryBids = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const sort = req.query.sort === 'high_to_low' ? 'high_to_low' : 'low_to_high'
  const delivery = await Delivery.findById(deliveryId).lean()
  if (!delivery) return notFound(res, 'Freight request not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const bids = await FreightBid.find({ deliveryId })
    .populate('carrierId', 'carrierName')
    .lean()

  const stats = buildDeliveryBidStats(bids)
  const lowestId = stats.lowestBid?._id ? String(stats.lowestBid._id) : null

  const mapped = bids
    .map((row) => mapPlantFreightBidRow(row, {
      lowestId,
      bidAmount: getSubmittedBidAmount(row),
    }))

  mapped.sort((a, b) => {
    if (a.bidAmount == null && b.bidAmount == null) return 0
    if (a.bidAmount == null) return 1
    if (b.bidAmount == null) return -1
    return sort === 'high_to_low'
      ? Number(b.bidAmount) - Number(a.bidAmount)
      : Number(a.bidAmount) - Number(b.bidAmount)
  })

  return success(res, {
    requestId: delivery._id,
    projectName: access.lead.projectName || '',
    status: delivery.status,
    stats: {
      totalBids: stats.totalBids,
      submittedBids: stats.submittedBids,
      awardedBid: stats.awardedBid ? stats.awardedBid._normalizedBidAmount : null,
      averageBid: stats.averageBid,
      potentialSavings: stats.potentialSavings,
    },
    bidRange: {
      lowestBid: stats.lowestBid
        ? { bidId: stats.lowestBid._id, amount: stats.lowestBid._normalizedBidAmount, carrierId: stats.lowestBid.carrierId?._id || stats.lowestBid.carrierId, carrierName: stats.lowestBid.carrierId?.carrierName || '' }
        : null,
      highestBid: stats.highestBid
        ? { bidId: stats.highestBid._id, amount: stats.highestBid._normalizedBidAmount, carrierId: stats.highestBid.carrierId?._id || stats.highestBid.carrierId, carrierName: stats.highestBid.carrierId?.carrierName || '' }
        : null,
    },
    sort,
    bids: mapped,
  })
})

exports.sendDeliveryBidsByProject = asyncHandler(async (req, res) => {
  const lead = await resolveLeadByProjectRef(req.params.projectId)
  if (!lead) return notFound(res, 'Project not found')

  const access = await assertPlantProjectAccess(lead._id, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const delivery = await Delivery.findOne({ leadId: lead._id }).sort({ createdAt: -1 })
  if (!delivery) return notFound(res, 'Freight request not found for this project')

  req.params.deliveryId = String(delivery._id)
  return exports.sendDeliveryBids(req, res)
})

exports.getDeliveryBidsByProject = asyncHandler(async (req, res) => {
  const lead = await resolveLeadByProjectRef(req.params.projectId)
  if (!lead) return notFound(res, 'Project not found')

  const access = await assertPlantProjectAccess(lead._id, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const delivery = await Delivery.findOne({ leadId: lead._id }).sort({ createdAt: -1 }).lean()
  if (!delivery) return notFound(res, 'Freight request not found for this project')

  req.params.deliveryId = String(delivery._id)
  return exports.getDeliveryBids(req, res)
})

const DELIVERY_DETAIL_POPULATE = [
  {
    path: 'leadId',
    select: 'projectName jobId customerId',
    populate: { path: 'customerId', select: 'firstName lastName email phone location' },
  },
  {
    path: 'selectedCarrierBidId',
    select: 'quotedAmount carrierId status carrierNotes selectedAt submittedAt currency',
    populate: { path: 'carrierId', select: 'carrierName contactName phone email' },
  },
]

const buildShipperDetails = (vendor) => (
  vendor
    ? {
        vendorId: vendor._id,
        vendorName: vendor.vendorName || '',
        personName: vendor.contactName || '',
        number: vendor.phone || '',
        email: vendor.email || '',
      }
    : null
)

const buildSelectedBidDetails = (selectedBidDoc) => mapSelectedFreightBidDetails(selectedBidDoc)

const buildDeliveryFormDetails = (delivery) => ({
  description: delivery.description || '',
  loadDescription: delivery.loadDescription || '',
  loadWeight: delivery.loadWeight ?? null,
  dimensions: delivery.dimensions || {},
  materialType: delivery.materialType || '',
  packageCount: delivery.packageCount ?? null,
  loadingEquipment: delivery.loadingEquipment || [],
  bidDeadline: delivery.bidDeadline,
  documentUrl: delivery.documentUrl || '',
  pickupLocation: delivery.pickupLocation || '',
  pickupLocationData: delivery.pickupLocationData || {},
  deliveryLocation: delivery.deliveryLocation || '',
  deliveryLocationData: delivery.deliveryLocationData || {},
  pickupDate: delivery.pickupDate,
  pickupTime: delivery.pickupTime || '',
  deliveryDate: delivery.deliveryDate,
  deliveryTime: delivery.deliveryTime || '',
  timeWindowStart: delivery.timeWindowStart || delivery.deliveryTime || '',
  timeWindowEnd: delivery.timeWindowEnd || '',
  timings: delivery.timings || '',
  receivingPoc: delivery.receivingPoc || '',
  pickupContactPhone: delivery.pickupContactPhone || '',
  specialRequirements: delivery.specialRequirements || '',
  additionalNotes: delivery.additionalNotes || '',
  rescheduleHistory: (delivery.rescheduleHistory || []).map((row) => ({
    _id: row._id,
    date: row.date,
    timeWindowStart: row.timeWindowStart || '',
    timeWindowEnd: row.timeWindowEnd || '',
    reason: row.reason || '',
    additionalNotes: row.additionalNotes || '',
    rescheduledAt: row.rescheduledAt,
    rescheduledBy: row.rescheduledBy,
  })),
})

const buildDeliveryDetailPayload = async (delivery, plantUserId) => {
  const leadId = delivery.leadId?._id || delivery.leadId

  const [bundlePlan, packingListPlan, poOrder, latestShipperRequest, loadDetails] = await Promise.all([
    BundlePlan.findOne({ leadId, status: { $ne: 'cancelled' } })
      .sort({ updatedAt: -1 })
      .select('_id totalBundles totalWeight')
      .lean(),
    PackingListPlan.findOne({ leadId, status: { $ne: 'cancelled' } })
      .sort({ updatedAt: -1 })
      .select('_id totalPackingLists')
      .lean(),
    POOrder.findOne({ leadId, assignedTo: plantUserId, status: 'approved' })
      .sort({ createdAt: -1 })
      .select('assignedTo')
      .populate('assignedTo', 'name email phone')
      .lean(),
    ShipperRequest.findOne({
      leadId,
      status: 'approved',
    })
      .sort({ updatedAt: -1 })
      .select('vendorId')
      .populate('vendorId', 'vendorName contactName phone email')
      .lean(),
    loadFreightLoadDetailsByLeadId(leadId),
  ])

  const vendor =
    latestShipperRequest?.vendorId &&
    typeof latestShipperRequest.vendorId === 'object'
      ? latestShipperRequest.vendorId
      : null

  const carrier = delivery.selectedCarrierBidId?.carrierId || null
  const customer = delivery.leadId?.customerId || null
  const owner = poOrder?.assignedTo || null
  const shipperDetails = buildShipperDetails(vendor)
  const selectedBid = buildSelectedBidDetails(delivery.selectedCarrierBidId)

  return {
    delivery: {
      deliveryId: delivery._id,
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      statusHistory: makeDeliveryStatusHistory(delivery),

      project: {
        leadId,
        projectName: delivery.leadId?.projectName || '',
        jobId: delivery.leadId?.jobId || '',
      },
      customer: customer
        ? {
            customerId: customer._id,
            customerName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
          }
        : null,

      formDetails: buildDeliveryFormDetails(delivery),

      deliverySchedule: {
        deliveryDate: delivery.deliveryDate,
        timeWindow: delivery.timings || formatDeliveryTimeWindow(
          delivery.timeWindowStart || delivery.deliveryTime,
          delivery.timeWindowEnd
        ),
        timeWindowStart: delivery.timeWindowStart || delivery.deliveryTime || '',
        timeWindowEnd: delivery.timeWindowEnd || '',
        pickupAddress: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
        dropoffAddress: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
      },

      deliveryInformation: {
        description: delivery.loadDescription || delivery.description || '',
        materialCategory: delivery.materialType || '',
        pickupDate: delivery.pickupDate,
      },

      shipperDetails,
      vendorDetails: shipperDetails,

      deliveryCompanyDetails: carrier
        ? {
            carrierId: carrier._id,
            carrierName: carrier.carrierName || '',
            personName: carrier.contactName || '',
            number: carrier.phone || '',
            email: carrier.email || '',
          }
        : null,

      selectedBid,

      internalOwner: owner
        ? {
            userId: owner._id,
            name: owner.name || '',
            email: owner.email || '',
            phone: owner.phone || '',
          }
        : null,

      siteCoordinationNotes: delivery.additionalNotes || '',
      equipmentRequirement: delivery.loadingEquipment || [],

      deliveryTypeAndSize: {
        bundleCount: bundlePlan?.totalBundles ?? null,
        packageCount: packingListPlan?.totalPackingLists ?? (delivery.packageCount ?? null),
        totalWeight: bundlePlan?.totalWeight ?? delivery.loadWeight ?? null,
      },

      bundlePlan: loadDetails.bundlePlan,
      packingListPlan: loadDetails.packingListPlan,
      bundles: loadDetails.bundles,
      packingLists: loadDetails.packingLists,

      receivingPocDetails: {
        receivingPoc: delivery.receivingPoc || '',
        pickupContactPhone: delivery.pickupContactPhone || '',
      },
    },
  }
}

exports.getProjectConfirmedDelivery = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertPlantProjectAccess(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const delivery = await Delivery.findOne({
    leadId: access.lead._id,
    selectedCarrierBidId: { $ne: null },
    status: { $in: SELECTED_DELIVERY_STATUSES },
  })
    .sort({ updatedAt: -1 })
    .populate(DELIVERY_DETAIL_POPULATE)
    .lean()

  if (!delivery) {
    return notFound(res, 'No selected/confirmed delivery found for this project')
  }

  const payload = await buildDeliveryDetailPayload(delivery, req.user._id)
  return success(res, payload)
})

exports.getDeliveryDetail = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
    .populate(DELIVERY_DETAIL_POPULATE)
    .lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  const leadId = delivery.leadId?._id || delivery.leadId
  const access = await assertPlantProjectAccess(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const payload = await buildDeliveryDetailPayload(delivery, req.user._id)
  return success(res, payload)
})

exports.getFreightLoadStats = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req)
  if (!leadIds.length) {
    return success(res, {
      totalLoads: 0,
      requestedLoads: 0,
      bidsPending: 0,
      inTransit: 0,
      delivered: 0,
      totalSpent: 0,
    })
  }

  const deliveries = await Delivery.find({
    leadId: { $in: leadIds },
    status: { $ne: 'draft' },
  })
    .select('_id status selectedCarrierBidId')
    .lean()

  const deliveryIds = deliveries.map((d) => d._id)
  const bids = deliveryIds.length
    ? await FreightBid.find({ deliveryId: { $in: deliveryIds } }).select('deliveryId status').lean()
    : []
  const bidsByDelivery = bids.reduce((acc, row) => {
    const key = String(row.deliveryId)
    if (!acc[key]) acc[key] = []
    acc[key].push(row)
    return acc
  }, {})

  const selectedBidIds = deliveries.map((d) => d.selectedCarrierBidId).filter(Boolean)
  const selectedBids = selectedBidIds.length
    ? await FreightBid.find({ _id: { $in: selectedBidIds } }).select('_id quotedAmount').lean()
    : []
  const selectedBidMap = new Map(selectedBids.map((b) => [String(b._id), b]))

  let totalSpent = 0
  let bidsPending = 0
  for (const delivery of deliveries) {
    const selected = delivery.selectedCarrierBidId
      ? selectedBidMap.get(String(delivery.selectedCarrierBidId))
      : null
    if (selected?.quotedAmount != null) {
      totalSpent += Number(selected.quotedAmount) || 0
    }

    const rows = bidsByDelivery[String(delivery._id)] || []
    const hasSelected = rows.some((row) => row.status === 'selected')
    const hasSentOrSubmitted = rows.some((row) => row.status === 'sent' || row.status === 'submitted')
    if (!hasSelected && hasSentOrSubmitted) bidsPending += 1
  }

  return success(res, {
    totalLoads: deliveries.length,
    requestedLoads: deliveries.filter((d) => d.status !== 'cancelled').length,
    bidsPending,
    inTransit: deliveries.filter((d) => d.status === 'in_transit').length,
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
    totalSpent: Math.round(totalSpent * 100) / 100,
  })
})

const getFreightLoadsCommon = async (req, res, { awardedOnly }) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20))
  const skip = (page - 1) * limit

  const baseFilter = buildDeliveryBaseFilter(req.query)
  if (!baseFilter.status) {
    // Freight loads view excludes unsent draft requests by default.
    baseFilter.status = { $ne: 'draft' }
  }

  const assignedLeadIds = await getAssignedLeadIds(req)
  if (!assignedLeadIds.length) {
    return success(res, { requests: [], total: 0, page, limit })
  }

  baseFilter.leadId = baseFilter.leadId || { $in: assignedLeadIds }
  if (baseFilter.leadId?.$in) {
    baseFilter.leadId = { $in: baseFilter.leadId.$in.filter((id) => assignedLeadIds.some((a) => String(a) === String(id))) }
  } else if (!assignedLeadIds.some((a) => String(a) === String(baseFilter.leadId))) {
    return success(res, { requests: [], total: 0, page, limit })
  }

  const searchFilter = buildDeliverySearchFilter(req.query.search)

  const customerFilterId = baseFilter._customerId
  delete baseFilter._customerId

  const pipeline = [{ $match: baseFilter }]
  pipeline.push({
    $lookup: {
      from: 'leads',
      localField: 'leadId',
      foreignField: '_id',
      as: 'leadDoc',
    },
  })
  pipeline.push({
    $unwind: '$leadDoc',
  })

  if (customerFilterId) {
    pipeline.push({
      $match: { 'leadDoc.customerId': customerFilterId },
    })
  }

  if (searchFilter) {
    pipeline.push({
      $match: {
        $or: [
          ...(searchFilter.$or || []),
          { 'leadDoc.projectName': new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
          { 'leadDoc.jobId': new RegExp(String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        ],
      },
    })
  }

  pipeline.push({
    $lookup: {
      from: 'freightbids',
      localField: 'selectedCarrierBidId',
      foreignField: '_id',
      as: 'selectedBidDoc',
    },
  })
  pipeline.push({
    $unwind: { path: '$selectedBidDoc', preserveNullAndEmptyArrays: true },
  })
  pipeline.push({
    $lookup: {
      from: 'freightcarriers',
      localField: 'selectedBidDoc.carrierId',
      foreignField: '_id',
      as: 'selectedCarrierDoc',
    },
  })
  pipeline.push({
    $unwind: { path: '$selectedCarrierDoc', preserveNullAndEmptyArrays: true },
  })

  if (req.query.carrierId) {
    const carrierId = toObjectId(req.query.carrierId)
    if (!carrierId) return badRequest(res, 'Invalid carrierId')
    pipeline.push({ $match: { 'selectedCarrierDoc._id': carrierId } })
  }

  if (awardedOnly) {
    pipeline.push({
      $match: { selectedCarrierBidId: { $ne: null } },
    })
  }

  pipeline.push({ $sort: { createdAt: -1 } })

  const [rows, totalRows] = await Promise.all([
    Delivery.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
    Delivery.aggregate([...pipeline, { $count: 'total' }]),
  ])

  const total = totalRows[0]?.total || 0
  const leadIds = [...new Set(rows.map((r) => r.leadId?._id || r.leadId).filter(Boolean).map(String))]
  const shipperMap = await fetchShipperVendorsByLeadIds(leadIds)

  const requests = rows.map((row) => {
    const mapped = mapDeliveryListRow({
      ...row,
      leadId: {
        _id: row.leadDoc?._id || row.leadId,
        projectName: row.leadDoc?.projectName || '',
        jobId: row.leadDoc?.jobId || '',
      },
      selectedCarrierBidId: row.selectedBidDoc
        ? {
            ...row.selectedBidDoc,
            carrierId: row.selectedCarrierDoc
              ? {
                  _id: row.selectedCarrierDoc._id,
                  carrierName: row.selectedCarrierDoc.carrierName || '',
                }
              : null,
          }
        : null,
      _shipperVendor: shipperMap.get(String(row.leadDoc?._id || row.leadId)) || null,
    })
    if (awardedOnly) {
      mapped.awardedCarrierId = mapped.carrier?._id || null
    }
    return mapped
  })

  return success(res, { requests, total, page, limit })
}

exports.getFreightLoads = asyncHandler(async (req, res) => {
  return getFreightLoadsCommon(req, res, { awardedOnly: false })
})

exports.getAwardedLoadStats = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req)
  if (!leadIds.length) {
    return success(res, {
      totalAwarded: 0,
      inTransit: 0,
      delivered: 0,
      totalSpent: 0,
    })
  }

  const deliveries = await Delivery.find({
    leadId: { $in: leadIds },
    selectedCarrierBidId: { $ne: null },
  })
    .select('status selectedCarrierBidId')
    .lean()

  const selectedBidIds = deliveries.map((d) => d.selectedCarrierBidId).filter(Boolean)
  const selectedBids = selectedBidIds.length
    ? await FreightBid.find({ _id: { $in: selectedBidIds } }).select('_id quotedAmount').lean()
    : []
  const selectedBidMap = new Map(selectedBids.map((b) => [String(b._id), b]))

  const totalSpent = deliveries.reduce((sum, d) => {
    const bid = d.selectedCarrierBidId ? selectedBidMap.get(String(d.selectedCarrierBidId)) : null
    return sum + (Number(bid?.quotedAmount) || 0)
  }, 0)

  return success(res, {
    totalAwarded: deliveries.length,
    inTransit: deliveries.filter((d) => d.status === 'in_transit').length,
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
    totalSpent: Math.round(totalSpent * 100) / 100,
  })
})

exports.getAwardedLoads = asyncHandler(async (req, res) => {
  return getFreightLoadsCommon(req, res, { awardedOnly: true })
})

exports.getDeliveryCalendar = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req)
  if (!leadIds.length) {
    return success(res, { dates: [] })
  }

  const baseFilter = buildDeliveryBaseFilter(req.query)
  const customerFilterId = baseFilter._customerId
  delete baseFilter._customerId
  if (baseFilter.deliveryDate) {
    const range = { ...baseFilter.deliveryDate }
    delete baseFilter.deliveryDate
    baseFilter.$or = [
      { deliveryDate: range },
      { deliveryDate: null, pickupDate: range },
    ]
  }
  baseFilter.leadId = baseFilter.leadId || { $in: leadIds }
  baseFilter.status = { $in: CALENDAR_DELIVERY_STATUSES }
  if (baseFilter.leadId?.$in) {
    baseFilter.leadId = { $in: baseFilter.leadId.$in.filter((id) => leadIds.some((a) => String(a) === String(id))) }
  } else if (!leadIds.some((a) => String(a) === String(baseFilter.leadId))) {
    return success(res, { dates: [] })
  }

  const deliveries = await Delivery.find(baseFilter)
    .populate({
      path: 'leadId',
      select: 'projectName jobId customerId',
      populate: { path: 'customerId', select: 'firstName lastName email' },
    })
    .populate({
      path: 'selectedCarrierBidId',
      select: 'quotedAmount carrierId status',
      populate: { path: 'carrierId', select: 'carrierName' },
    })
    .sort({ deliveryDate: 1, deliveryTime: 1, createdAt: 1 })
    .lean()

  const filteredDeliveries = customerFilterId
    ? deliveries.filter((d) => String(d.leadId?.customerId?._id || d.leadId?.customerId) === String(customerFilterId))
    : deliveries

  // Filter out deliveries with no lead BEFORE stringifying — String(null) is the truthy string
  // "null", which .filter(Boolean) doesn't catch and then fails ObjectId casting downstream.
  const leadIdsInRows = [...new Set(
    filteredDeliveries.map((d) => d.leadId?._id || d.leadId).filter(Boolean).map(String)
  )]
  const shipperMap = await fetchShipperVendorsByLeadIds(leadIdsInRows)

  const grouped = new Map()
  for (const row of filteredDeliveries) {
    const calendarDate = resolveCalendarDate(row)
    const dateKey = calendarDate ? new Date(calendarDate).toISOString().slice(0, 10) : 'undated'
    if (!grouped.has(dateKey)) grouped.set(dateKey, [])
    grouped.get(dateKey).push({
      ...mapDeliveryListRow({
        ...row,
        _shipperVendor: shipperMap.get(String(row.leadId?._id || row.leadId)) || null,
      }),
      // Include full delivery source object for calendar detail usage
      delivery: row,
    })
  }

  const dates = [...grouped.entries()].map(([date, rows]) => ({
    date,
    totalDeliveries: rows.length,
    deliveries: rows,
  }))

  return success(res, { dates })
})

exports.getAllDeliveryStats = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req)
  if (!leadIds.length) {
    return success(res, {
      totalCount: 0,
      draftCount: 0,
      scheduledCount: 0,
      confirmedCount: 0,
      inTransitCount: 0,
      deliveredCount: 0,
      delayedCount: 0,
      cancelledCount: 0,
    })
  }

  const deliveries = await Delivery.find({ leadId: { $in: leadIds } }).select('status').lean()
  return success(res, buildDeliveryStats(deliveries))
})

exports.getAllDeliveries = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20))
  const skip = (page - 1) * limit

  const assignedLeadIds = await getAssignedLeadIds(req)
  if (!assignedLeadIds.length) {
    return success(res, { deliveries: [], total: 0, page, limit })
  }

  const baseFilter = buildDeliveryBaseFilter(req.query)
  baseFilter.leadId = baseFilter.leadId || { $in: assignedLeadIds }
  if (baseFilter.leadId?.$in) {
    baseFilter.leadId = { $in: baseFilter.leadId.$in.filter((id) => assignedLeadIds.some((a) => String(a) === String(id))) }
  } else if (!assignedLeadIds.some((a) => String(a) === String(baseFilter.leadId))) {
    return success(res, { deliveries: [], total: 0, page, limit })
  }

  const searchFilter = buildDeliverySearchFilter(req.query.search)

  const customerFilterId = baseFilter._customerId
  delete baseFilter._customerId

  const pipeline = [{ $match: baseFilter }]
  pipeline.push({
    $lookup: {
      from: 'leads',
      localField: 'leadId',
      foreignField: '_id',
      as: 'leadDoc',
    },
  })
  pipeline.push({ $unwind: '$leadDoc' })
  pipeline.push({
    $lookup: {
      from: 'customers',
      localField: 'leadDoc.customerId',
      foreignField: '_id',
      as: 'customerDoc',
    },
  })
  pipeline.push({ $unwind: { path: '$customerDoc', preserveNullAndEmptyArrays: true } })

  if (customerFilterId) {
    pipeline.push({
      $match: { 'customerDoc._id': customerFilterId },
    })
  }

  pipeline.push({
    $lookup: {
      from: 'freightbids',
      localField: 'selectedCarrierBidId',
      foreignField: '_id',
      as: 'selectedBidDoc',
    },
  })
  pipeline.push({ $unwind: { path: '$selectedBidDoc', preserveNullAndEmptyArrays: true } })
  pipeline.push({
    $lookup: {
      from: 'freightcarriers',
      localField: 'selectedBidDoc.carrierId',
      foreignField: '_id',
      as: 'selectedCarrierDoc',
    },
  })
  pipeline.push({ $unwind: { path: '$selectedCarrierDoc', preserveNullAndEmptyArrays: true } })

  if (req.query.carrierId) {
    const carrierId = toObjectId(req.query.carrierId)
    if (!carrierId) return badRequest(res, 'Invalid carrierId')
    pipeline.push({ $match: { 'selectedCarrierDoc._id': carrierId } })
  }

  if (searchFilter || req.query.search) {
    const keyword = String(req.query.search || '').trim()
    const rx = keyword
      ? new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      : null
    pipeline.push({
      $match: {
        $or: [
          ...((searchFilter && searchFilter.$or) || []),
          ...(rx
            ? [
                { 'leadDoc.projectName': rx },
                { 'leadDoc.jobId': rx },
                { 'customerDoc.firstName': rx },
                { 'customerDoc.lastName': rx },
                { 'customerDoc.email': rx },
                { 'selectedCarrierDoc.carrierName': rx },
              ]
            : []),
        ],
      },
    })
  }

  pipeline.push({ $sort: { createdAt: -1 } })

  const [rows, totalRows] = await Promise.all([
    Delivery.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
    Delivery.aggregate([...pipeline, { $count: 'total' }]),
  ])
  const total = totalRows[0]?.total || 0

  const leadIds = [...new Set(rows.map((r) => r.leadDoc?._id || r.leadId).filter(Boolean).map(String))]
  const shipperMap = await fetchShipperVendorsByLeadIds(leadIds)

  const deliveries = rows.map((row) =>
    mapDeliveryListRow({
      ...row,
      leadId: {
        _id: row.leadDoc?._id || row.leadId,
        projectName: row.leadDoc?.projectName || '',
        jobId: row.leadDoc?.jobId || '',
        customerId: row.customerDoc
          ? {
              _id: row.customerDoc._id,
              firstName: row.customerDoc.firstName || '',
              lastName: row.customerDoc.lastName || '',
              email: row.customerDoc.email || '',
            }
          : null,
      },
      selectedCarrierBidId: row.selectedBidDoc
        ? {
            ...row.selectedBidDoc,
            carrierId: row.selectedCarrierDoc
              ? {
                  _id: row.selectedCarrierDoc._id,
                  carrierName: row.selectedCarrierDoc.carrierName || '',
                }
              : null,
          }
        : null,
      _shipperVendor: shipperMap.get(String(row.leadDoc?._id || row.leadId)) || null,
    })
  )

  return success(res, { deliveries, total, page, limit })
})

exports.rescheduleDelivery = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const {
    date,
    timeWindowStart,
    timeWindowEnd,
    rescheduleReason,
    additionalNotes,
  } = req.body

  const delivery = await Delivery.findById(deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (DELIVERY_RESCHEDULE_BLOCKED_STATUSES.has(delivery.status)) {
    return badRequest(res, `Cannot reschedule a delivery with status ${delivery.status}`)
  }

  const newDate = normalizeDateOnly(date)
  if (!newDate) return badRequest(res, 'Valid date is required')

  const start = String(timeWindowStart || '').trim()
  const end = String(timeWindowEnd || '').trim()
  const reason = String(rescheduleReason || '').trim()
  if (!start) return badRequest(res, 'timeWindowStart is required')
  if (!end) return badRequest(res, 'timeWindowEnd is required')
  if (!reason) return badRequest(res, 'rescheduleReason is required')

  const notes = additionalNotes !== undefined
    ? String(additionalNotes).trim()
    : delivery.additionalNotes

  const previousDate = delivery.deliveryDate

  delivery.deliveryDate = newDate
  delivery.deliveryTime = start
  delivery.timeWindowStart = start
  delivery.timeWindowEnd = end
  delivery.timings = formatDeliveryTimeWindow(start, end)
  delivery.additionalNotes = notes
  delivery.rescheduleHistory.push({
    previousDate,
    date: newDate,
    timeWindowStart: start,
    timeWindowEnd: end,
    reason,
    additionalNotes: notes,
    rescheduledAt: new Date(),
    rescheduledBy: req.user._id,
  })

  await delivery.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.DELIVERY_RESCHEDULED,
    leadId: delivery.leadId,
    customerId: access.lead.customerId,
    performedBy: req.user._id,
    metadata: {
      deliveryId: delivery._id,
      deliveryNumber: delivery.deliveryNumber,
      date: newDate,
      timeWindowStart: start,
      timeWindowEnd: end,
      rescheduleReason: reason,
    },
  })

  const latestReschedule = delivery.rescheduleHistory[delivery.rescheduleHistory.length - 1]

  return success(res, {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    status: delivery.status,
    deliveryDate: delivery.deliveryDate,
    timeWindowStart: delivery.timeWindowStart,
    timeWindowEnd: delivery.timeWindowEnd,
    timings: delivery.timings,
    rescheduleReason: reason,
    additionalNotes: delivery.additionalNotes,
    reschedule: latestReschedule
      ? {
          _id: latestReschedule._id,
          previousDate: latestReschedule.previousDate,
          date: latestReschedule.date,
          timeWindowStart: latestReschedule.timeWindowStart,
          timeWindowEnd: latestReschedule.timeWindowEnd,
          reason: latestReschedule.reason,
          additionalNotes: latestReschedule.additionalNotes,
          rescheduledAt: latestReschedule.rescheduledAt,
          rescheduledBy: latestReschedule.rescheduledBy,
          acknowledged: latestReschedule.acknowledged,
        }
      : null,
    rescheduleHistory: delivery.rescheduleHistory,
  }, 'Delivery rescheduled')
})

exports.updateDeliveryStatus = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const { status } = req.body

  const delivery = await Delivery.findById(deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const currentStatus = delivery.status
  if (currentStatus === status) {
    return success(res, { delivery }, 'Delivery status unchanged')
  }

  const allowed = DELIVERY_STATUS_TRANSITIONS[currentStatus] || []
  if (!allowed.includes(status)) {
    return badRequest(
      res,
      `Invalid status transition from ${currentStatus} to ${status}`,
      { allowedTransitions: allowed }
    )
  }

  delivery.status = status
  delivery.statusHistory = [
    ...makeDeliveryStatusHistory(delivery),
    { status, changedAt: new Date() },
  ]
  await delivery.save()

  return success(res, { delivery }, 'Delivery status updated')
})
