const FreightBid = require('../../models/FreightBid')
const Delivery = require('../../models/Delivery')
const FreightCarrier = require('../../models/FreightCarrier')
const Lead = require('../../models/Lead')
const { success, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const isBidLinkActive = (bid, delivery) => {
  const activeStatuses = new Set(['sent', 'submitted'])
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

  return success(res, {
    bidId: bid._id,
    status: bid.status,
    carrierName: carrier?.carrierName || '',
    projectName: lead?.projectName || '',
    jobId: lead?.jobId || '',
    deliveryNumber: delivery.deliveryNumber || '',
    description: delivery.loadDescription || delivery.description || '',
    pickupLocation: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
    deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
    bidDeadline: bid.expiresAt,
    quotedAmount: bid.quotedAmount,
    carrierNotes: bid.carrierNotes || '',
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
  await bid.save()

  return success(res, {
    bidId: bid._id,
    status: bid.status,
    quotedAmount: bid.quotedAmount,
    carrierNotes: bid.carrierNotes,
    submittedAt: bid.submittedAt,
  }, 'Freight bid submitted')
})
