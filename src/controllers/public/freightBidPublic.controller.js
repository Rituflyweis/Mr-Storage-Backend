const FreightBid = require('../../models/FreightBid')
const Delivery = require('../../models/Delivery')
const FreightCarrier = require('../../models/FreightCarrier')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { loadFreightLoadDetailsByLeadId } = require('../../services/plant/freightLoadDetails.service')
const { mapPublicFreightBidRevisionNote } = require('../../utils/freightBidDisplay')
const { notifyPlantUsersForLead } = require('../../utils/notifyPlantUsers')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

const PENDING_FREIGHT_BID_STATUSES = new Set(['sent', 'resubmit_requested'])

const areAllFreightBidsSubmitted = (bids = []) =>
  bids.length > 0 && bids.every((row) => !PENDING_FREIGHT_BID_STATUSES.has(row.status))

const isBidLinkActive = (bid, delivery) => {
  const activeStatuses = new Set(['sent', 'submitted', 'resubmit_requested'])
  if (!activeStatuses.has(bid.status)) return false
  if (delivery.status === 'cancelled') return false
  if (bid.expiresAt && new Date(bid.expiresAt).getTime() < Date.now()) return false
  return true
}

exports.getFreightBidInfo = asyncHandler(async (req, res) => {
  const { token } = req.params
  const bid = await FreightBid.findOne({ token }).lean()
  if (!bid) return badRequest(res, 'Invalid or expired bid link')

  const [delivery, carrier] = await Promise.all([
    Delivery.findById(bid.deliveryId).lean(),
    FreightCarrier.findById(bid.carrierId).select('carrierName').lean(),
  ])

  if (!delivery) return badRequest(res, 'Freight request not found')
  const lead = delivery.leadId
    ? await Lead.findById(delivery.leadId).select('projectName jobId').lean()
    : null
  if (!isBidLinkActive(bid, delivery)) {
    return badRequest(res, `This bid link is not active (status: ${bid.status})`)
  }

  const loadDetails = delivery.leadId
    ? await loadFreightLoadDetailsByLeadId(delivery.leadId)
    : { bundlePlan: null, packingListPlan: null, bundles: [], packingLists: [] }

  const revisionNote = mapPublicFreightBidRevisionNote(bid)

  return success(res, {
    bidId: bid._id,
    status: bid.status,
    carrierName: carrier?.carrierName || '',
    projectName: lead?.projectName || '',
    jobId: lead?.jobId || '',
    deliveryNumber: delivery.deliveryNumber || '',
    description: delivery.loadDescription || delivery.description || '',
    loadWeight: delivery.loadWeight ?? null,
    dimensions: delivery.dimensions || {},
    materialType: delivery.materialType || '',
    packageCount: delivery.packageCount ?? null,
    pickupLocation: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
    deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
    bidDeadline: bid.expiresAt,
    quotedAmount: bid.quotedAmount,
    carrierNotes: bid.carrierNotes || '',
    resubmitNote: revisionNote,
    plantNote: revisionNote,
    resubmitRequestedAt: bid.resubmitRequestedAt || null,
    requestedBidAmount:
      bid.resubmitRequestedAmount != null && Number.isFinite(Number(bid.resubmitRequestedAmount))
        ? Number(bid.resubmitRequestedAmount)
        : null,
    resubmitCount: bid.resubmitCount || 0,
    bundlePlan: loadDetails.bundlePlan,
    packingListPlan: loadDetails.packingListPlan,
    bundles: loadDetails.bundles,
    packingLists: loadDetails.packingLists,
  })
})

exports.submitFreightBid = asyncHandler(async (req, res) => {
  const { token } = req.params
  const { quotedAmount, carrierNotes } = req.body
  const bid = await FreightBid.findOne({ token })
  if (!bid) return badRequest(res, 'Invalid or expired bid link')

  const delivery = await Delivery.findById(bid.deliveryId).lean()
  if (!delivery) return badRequest(res, 'Freight request not found')
  if (!isBidLinkActive(bid, delivery)) {
    if (bid.expiresAt && new Date(bid.expiresAt).getTime() < Date.now()) {
      bid.status = 'expired'
      await bid.save()
      return badRequest(res, 'Bid deadline has passed')
    }
    return badRequest(res, `This bid link is not active (status: ${bid.status})`)
  }

  bid.quotedAmount = Number(quotedAmount)
  bid.carrierNotes = String(carrierNotes || '').trim()
  bid.submittedAt = new Date()
  bid.status = 'submitted'
  bid.resubmitRequestedAmount = null
  await bid.save()

  const [carrier, lead, allBids] = await Promise.all([
    FreightCarrier.findById(bid.carrierId).select('carrierName').lean(),
    delivery.leadId
      ? Lead.findById(delivery.leadId).select('projectName jobId customerId').lean()
      : null,
    FreightBid.find({ deliveryId: delivery._id }).select('status').lean(),
  ])

  const leadId = delivery.leadId
  const allFreightBidsSubmitted = areAllFreightBidsSubmitted(allBids)

  if (leadId) {
    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.FREIGHT_BID_SUBMITTED,
      leadId,
      customerId: lead?.customerId || null,
      performedBy: null,
      metadata: {
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber || '',
        bidId: bid._id,
        carrierId: bid.carrierId,
        carrierName: carrier?.carrierName || '',
        quotedAmount: bid.quotedAmount,
        submittedAt: bid.submittedAt,
      },
    })

    await notifyPlantUsersForLead(leadId, 'freight_bid_submitted', {
      leadId,
      deliveryId: delivery._id,
      deliveryNumber: delivery.deliveryNumber || '',
      bidId: bid._id,
      carrierId: bid.carrierId,
      carrierName: carrier?.carrierName || '',
      submittedAt: bid.submittedAt,
      quotedAmount: bid.quotedAmount,
      projectName: lead?.projectName || '',
      jobId: lead?.jobId || '',
    })

    if (allFreightBidsSubmitted) {
      await auditService.log({
        type: 'plant',
        action: AUDIT_ACTIONS.ALL_FREIGHT_BIDS_SUBMITTED,
        leadId,
        customerId: lead?.customerId || null,
        performedBy: null,
        metadata: {
          deliveryId: delivery._id,
          deliveryNumber: delivery.deliveryNumber || '',
          bidCount: allBids.length,
        },
      })

      await notifyPlantUsersForLead(leadId, 'all_freight_bids_submitted', {
        leadId,
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber || '',
        bidCount: allBids.length,
        projectName: lead?.projectName || '',
        jobId: lead?.jobId || '',
      })
    }
  }

  return success(res, {
    bidId: bid._id,
    status: bid.status,
    quotedAmount: bid.quotedAmount,
    carrierNotes: bid.carrierNotes,
    submittedAt: bid.submittedAt,
    allFreightBidsSubmitted,
  }, 'Freight bid submitted')
})
