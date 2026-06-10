const crypto = require('crypto')
const Delivery = require('../../models/Delivery')
const BundlePlan = require('../../models/BundlePlan')
const Bundle = require('../../models/Bundle')
const PackingListPlan = require('../../models/PackingListPlan')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { sendFreightBidRequestEmail } = require('../../services/email/mailer')
const { CLIENT_URL } = require('../../config/env')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { resolveLeadByProjectRef } = require('../../utils/projectRef')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const getNextDeliveryNumber = async () => {
  const latest = await Delivery.findOne({
    deliveryNumber: { $regex: /^DEL-\d+$/ },
  }).sort({ createdAt: -1 }).select('deliveryNumber').lean()
  const current = latest?.deliveryNumber ? Number(String(latest.deliveryNumber).replace('DEL-', '')) : 0
  const next = Number.isFinite(current) ? current + 1 : 1
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

const toRounded = (value) => {
  if (!Number.isFinite(Number(value))) return null
  return Math.round(Number(value) * 100) / 100
}

const buildFreightAutofill = (bundlePlan, packingListPlan, bundles) => {
  const totalWeight = bundles.reduce((sum, row) => sum + Number(row.totalWeight || 0), 0)
  const maxLengthFeet = bundles.reduce((max, row) => Math.max(max, Number(row.maxLengthFeet || 0)), 0)
  const maxWidthFeet = bundles.reduce((max, row) => Math.max(max, Number(row.estimatedWidthFeet || 0)), 0)
  const maxHeightFeet = bundles.reduce((max, row) => Math.max(max, Number(row.estimatedHeightFeet || 0)), 0)
  const bundleTypes = [...new Set(bundles.map((row) => row.bundleType).filter(Boolean))]

  const loadDescription = `${bundles.length} bundle(s) for bundle plan ${bundlePlan.planNumber || ''}`.trim()

  return {
    loadDescription,
    weight: toRounded(totalWeight),
    dimensions: {
      lengthFeet: toRounded(maxLengthFeet),
      widthFeet: toRounded(maxWidthFeet),
      heightFeet: toRounded(maxHeightFeet),
    },
    metalType: bundleTypes.join(', '),
    packageCount: packingListPlan?.totalBundles || bundles.length,
  }
}

const buildDeliveryBidStats = (bids) => {
  const submitted = bids.filter((row) => Number.isFinite(Number(row.quotedAmount)))
  const sorted = [...submitted].sort((a, b) => Number(a.quotedAmount) - Number(b.quotedAmount))

  const totalBids = submitted.length
  const averageBid = totalBids
    ? Math.round((submitted.reduce((sum, row) => sum + Number(row.quotedAmount), 0) / totalBids) * 100) / 100
    : null

  const lowestBid = sorted[0] || null
  const highestBid = sorted[sorted.length - 1] || null
  const awardedBid = submitted.find((row) => row.status === 'selected') || null
  const potentialSavings = highestBid && awardedBid
    ? Math.max(0, Number(highestBid.quotedAmount) - Number(awardedBid.quotedAmount))
    : null

  return {
    totalBids,
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

  const access = await assertPlantProjectAccess(bundlePlan.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const [packingListPlan, bundles] = await Promise.all([
    PackingListPlan.findOne({ bundlePlanId }).lean(),
    Bundle.find({ bundlePlanId }).lean(),
  ])

  return success(res, buildFreightAutofill(bundlePlan, packingListPlan, bundles))
})

exports.getFreightAutofillByProject = asyncHandler(async (req, res) => {
  const lead = await resolveLeadByProjectRef(req.params.projectId)
  if (!lead) return notFound(res, 'Project not found')

  const access = await assertPlantProjectAccess(lead._id, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const bundlePlan = await BundlePlan.findOne({ leadId: lead._id, status: { $ne: 'cancelled' } })
    .sort({ updatedAt: -1 })
    .lean()
  if (!bundlePlan) return notFound(res, 'No bundle plan found for this project')

  const [packingListPlan, bundles] = await Promise.all([
    PackingListPlan.findOne({ bundlePlanId: bundlePlan._id }).lean(),
    Bundle.find({ bundlePlanId: bundlePlan._id }).lean(),
  ])

  return success(res, buildFreightAutofill(bundlePlan, packingListPlan, bundles))
})

exports.createDelivery = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  const access = await assertPlantProjectAccess(leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const deliveryNumber = await getNextDeliveryNumber()
  const delivery = await Delivery.create({
    leadId,
    deliveryNumber,
    status: 'draft',
    description: String(req.body.description || '').trim(),
    loadDescription: String(req.body.loadDescription || '').trim(),
    loadWeight: req.body.weight != null ? Number(req.body.weight) : null,
    dimensions: {
      lengthFeet: req.body.dimensions?.lengthFeet != null ? Number(req.body.dimensions.lengthFeet) : null,
      widthFeet: req.body.dimensions?.widthFeet != null ? Number(req.body.dimensions.widthFeet) : null,
      heightFeet: req.body.dimensions?.heightFeet != null ? Number(req.body.dimensions.heightFeet) : null,
    },
    materialType: String(req.body.metalType || '').trim(),
    packageCount: req.body.packageCount != null ? Number(req.body.packageCount) : null,
    loadingEquipment: Array.isArray(req.body.loadingEquipment)
      ? req.body.loadingEquipment.map((v) => String(v || '').trim()).filter(Boolean)
      : [],
    bidDeadline: req.body.bidDeadline ? new Date(req.body.bidDeadline) : null,
    documentUrl: String(req.body.documentUrl || '').trim(),
    pickupLocation: String(req.body.pickupLocation || '').trim(),
    pickupLocationData: normalizeLocationData(req.body.pickupLocationData || {}),
    deliveryLocation: String(req.body.deliveryLocation || '').trim(),
    deliveryLocationData: normalizeLocationData(req.body.deliveryLocationData || {}),
    pickupDate: req.body.pickupDate ? new Date(req.body.pickupDate) : null,
    pickupTime: String(req.body.pickupTime || '').trim(),
    deliveryDate: req.body.deliveryDate ? new Date(req.body.deliveryDate) : null,
    deliveryTime: String(req.body.deliveryTime || '').trim(),
    timings: String(req.body.timings || '').trim(),
    receivingPoc: String(req.body.receivingPoc || '').trim(),
    pickupContactPhone: String(req.body.pickupContactPhone || '').trim(),
    specialRequirements: String(req.body.specialRequirements || '').trim(),
    additionalNotes: String(req.body.additionalNotes || '').trim(),
  })

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

exports.getProjectDeliveries = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertPlantProjectAccess(leadId, req.user._id)
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
    return {
      requestId: delivery._id,
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
    }
  })

  return success(res, { requests: rows, total: rows.length })
})

exports.sendDeliveryBids = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const { carrierIds, bidDeadline } = req.body
  const delivery = await Delivery.findById(deliveryId)
  if (!delivery) return notFound(res, 'Freight request not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req.user._id)
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
      await bid.save()
    }

    const bidUrl = `${CLIENT_URL}/freight-bid/${bid.token}`
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
        })
      }
      sent.push({ bidId: bid._id, carrierId: carrier._id, carrierName: carrier.carrierName, expiresAt: bid.expiresAt })
    } catch (err) {
      failures.push({ carrierId: carrier._id, carrierName: carrier.carrierName, error: err.message })
    }
  }

  delivery.bidDeadline = deadline
  delivery.status = 'bidding_sent'
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

  const access = await assertPlantProjectAccess(delivery.leadId, req.user._id)
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
    .map((row) => ({
      bidId: row._id,
      carrierId: row.carrierId?._id || row.carrierId,
      carrierName: row.carrierId?.carrierName || '',
      submittedAt: row.submittedAt,
      carrierNote: row.carrierNotes || '',
      bidAmount: Number.isFinite(Number(row.quotedAmount)) ? Number(row.quotedAmount) : null,
      status: row.status,
      isLowest: lowestId ? String(row._id) === lowestId : false,
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
      awardedBid: stats.awardedBid ? Number(stats.awardedBid.quotedAmount) : null,
      averageBid: stats.averageBid,
      potentialSavings: stats.potentialSavings,
    },
    bidRange: {
      lowestBid: stats.lowestBid
        ? { bidId: stats.lowestBid._id, amount: Number(stats.lowestBid.quotedAmount), carrierId: stats.lowestBid.carrierId?._id || stats.lowestBid.carrierId, carrierName: stats.lowestBid.carrierId?.carrierName || '' }
        : null,
      highestBid: stats.highestBid
        ? { bidId: stats.highestBid._id, amount: Number(stats.highestBid.quotedAmount), carrierId: stats.highestBid.carrierId?._id || stats.highestBid.carrierId, carrierName: stats.highestBid.carrierId?.carrierName || '' }
        : null,
    },
    sort,
    bids: mapped,
  })
})

exports.sendDeliveryBidsByProject = asyncHandler(async (req, res) => {
  const lead = await resolveLeadByProjectRef(req.params.projectId)
  if (!lead) return notFound(res, 'Project not found')

  const access = await assertPlantProjectAccess(lead._id, req.user._id)
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

  const access = await assertPlantProjectAccess(lead._id, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const delivery = await Delivery.findOne({ leadId: lead._id }).sort({ createdAt: -1 }).lean()
  if (!delivery) return notFound(res, 'Freight request not found for this project')

  req.params.deliveryId = String(delivery._id)
  return exports.getDeliveryBids(req, res)
})
