const FreightBid = require('../../models/FreightBid')
const Delivery = require('../../models/Delivery')
const FreightCarrier = require('../../models/FreightCarrier')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const {
  sendFreightBidAwardedEmail,
  sendFreightBidRejectedEmail,
  sendFreightBidResubmitRequestEmail,
} = require('../../services/email/mailer')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { CLIENT_URL } = require('../../config/env')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const FREIGHT_BID_RESUBMIT_ALLOWED_STATUSES = new Set(['submitted'])
const RESUBMIT_DEADLINE_EXTENSION_DAYS = 7

exports.selectFreightBid = asyncHandler(async (req, res) => {
  const { bidId } = req.params
  const selectedBid = await FreightBid.findById(bidId)
  if (!selectedBid) return notFound(res, 'Freight bid not found')

  const delivery = await Delivery.findById(selectedBid.deliveryId)
  if (!delivery) return notFound(res, 'Freight request not found')

  const access = await assertPlantProjectAccess(delivery.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (!Number.isFinite(Number(selectedBid.quotedAmount))) {
    return badRequest(res, 'Selected bid has no submitted amount')
  }

  const now = new Date()
  await FreightBid.updateMany(
    { deliveryId: delivery._id, _id: { $ne: selectedBid._id } },
    { $set: { status: 'rejected', selectedAt: null } }
  )

  selectedBid.status = 'selected'
  selectedBid.selectedAt = now
  await selectedBid.save()

  delivery.selectedCarrierBidId = selectedBid._id
  delivery.status = 'confirmed'
  delivery.statusHistory = [
    ...(Array.isArray(delivery.statusHistory) ? delivery.statusHistory : []),
    { status: 'carrier_selected', changedAt: now },
    { status: 'confirmed', changedAt: now },
  ]
  await delivery.save()

  const lead = await Lead.findById(delivery.leadId).select('customerId projectName jobId').lean()
  const allDeliveryBids = await FreightBid.find({ deliveryId: delivery._id })
    .populate('carrierId', 'carrierName email')
    .lean()
  const awardedRow = allDeliveryBids.find((row) => String(row._id) === String(selectedBid._id))
  const rejectedRows = allDeliveryBids.filter((row) => String(row._id) !== String(selectedBid._id))

  const emailFailures = []
  try {
    if (awardedRow?.carrierId?.email) {
      await sendFreightBidAwardedEmail({
        toEmail: awardedRow.carrierId.email,
        carrierName: awardedRow.carrierId.carrierName,
        projectName: lead?.projectName || '',
        jobId: lead?.jobId || '',
        deliveryNumber: delivery.deliveryNumber,
        quotedAmount: awardedRow.quotedAmount,
      })
    }
  } catch (err) {
    emailFailures.push({
      bidId: awardedRow?._id,
      carrierId: awardedRow?.carrierId?._id || awardedRow?.carrierId,
      type: 'awarded',
      error: err.message,
    })
  }

  for (const row of rejectedRows) {
    try {
      if (row?.carrierId?.email) {
        await sendFreightBidRejectedEmail({
          toEmail: row.carrierId.email,
          carrierName: row.carrierId.carrierName,
          projectName: lead?.projectName || '',
          jobId: lead?.jobId || '',
          deliveryNumber: delivery.deliveryNumber,
        })
      }
    } catch (err) {
      emailFailures.push({
        bidId: row._id,
        carrierId: row?.carrierId?._id || row?.carrierId,
        type: 'rejected',
        error: err.message,
      })
    }
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.FREIGHT_BID_SELECTED,
    leadId: delivery.leadId,
    customerId: lead?.customerId || null,
    performedBy: req.user._id,
    metadata: {
      deliveryId: delivery._id,
      selectedBidId: selectedBid._id,
      carrierId: selectedBid.carrierId,
      quotedAmount: selectedBid.quotedAmount,
      deliveryStatus: delivery.status,
    },
  })

  return success(res, {
    deliveryId: delivery._id,
    status: delivery.status,
    selectedBid: {
      bidId: selectedBid._id,
      carrierId: selectedBid.carrierId,
      quotedAmount: selectedBid.quotedAmount,
      selectedAt: selectedBid.selectedAt,
    },
    rejectedBidIds: rejectedRows.map((row) => row._id),
    emailFailures,
  }, 'Freight bid selected and delivery confirmed')
})

const normalizeOptionalBidAmount = (value) => {
  if (value === undefined || value === null || value === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

exports.requestFreightBidResubmit = asyncHandler(async (req, res) => {
  const { bidId } = req.params
  const note = String(req.body.note || '').trim()
  if (!note) return badRequest(res, 'note is required')
  const requestedBidAmount = normalizeOptionalBidAmount(
    req.body.bidAmount ?? req.body.requestedBidAmount
  )

  const bid = await FreightBid.findById(bidId)
  if (!bid) return notFound(res, 'Freight bid not found')

  if (!FREIGHT_BID_RESUBMIT_ALLOWED_STATUSES.has(bid.status)) {
    return badRequest(res, `Cannot request resubmit while status is ${bid.status}`)
  }

  const delivery = await Delivery.findById(bid.deliveryId)
  if (!delivery) return notFound(res, 'Freight request not found')

  if (delivery.status === 'cancelled') {
    return badRequest(res, 'Cannot request resubmit for a cancelled freight request')
  }

  const access = await assertPlantProjectAccess(delivery.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const priorQuotedAmount = bid.quotedAmount

  if (bid.quotedAmount != null || bid.submittedAt) {
    bid.submissionHistory.push({
      quotedAmount: bid.quotedAmount ?? null,
      carrierNotes: bid.carrierNotes || '',
      submittedAt: bid.submittedAt || null,
    })
  }

  bid.quotedAmount = null
  bid.carrierNotes = ''
  bid.submittedAt = null
  bid.selectedAt = null
  bid.status = 'resubmit_requested'
  bid.resubmitNote = note
  bid.resubmitRequestedAt = new Date()
  bid.resubmitRequestedAmount = requestedBidAmount
  bid.resubmitCount = (bid.resubmitCount || 0) + 1

  const now = Date.now()
  if (!bid.expiresAt || new Date(bid.expiresAt).getTime() < now) {
    bid.expiresAt = new Date(now + RESUBMIT_DEADLINE_EXTENSION_DAYS * 24 * 60 * 60 * 1000)
  }

  if (
    bid.expiresAt &&
    (!delivery.bidDeadline || new Date(bid.expiresAt).getTime() > new Date(delivery.bidDeadline).getTime())
  ) {
    delivery.bidDeadline = bid.expiresAt
    await delivery.save()
  }

  await bid.save()

  const [carrier, lead] = await Promise.all([
    FreightCarrier.findById(bid.carrierId).select('carrierName email').lean(),
    Lead.findById(delivery.leadId).select('projectName jobId customerId').lean(),
  ])

  const bidUrl = `${CLIENT_URL}/carrier/${bid.token}`
  const emailFailures = []
  try {
    if (carrier?.email) {
      await sendFreightBidResubmitRequestEmail({
        toEmail: carrier.email,
        carrierName: carrier.carrierName,
        projectName: lead?.projectName || '',
        jobId: lead?.jobId || '',
        deliveryNumber: delivery.deliveryNumber,
        note: bid.resubmitNote,
        bidUrl,
        bidDeadline: bid.expiresAt,
        priorQuotedAmount,
        requestedBidAmount,
      })
    }
  } catch (err) {
    emailFailures.push({ carrierId: carrier?._id, error: err.message })
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.FREIGHT_BID_RESUBMIT_REQUESTED,
    leadId: delivery.leadId,
    customerId: lead?.customerId || null,
    performedBy: req.user._id,
    metadata: {
      deliveryId: delivery._id,
      bidId: bid._id,
      carrierId: bid.carrierId,
      note: bid.resubmitNote,
      priorQuotedAmount,
      requestedBidAmount: bid.resubmitRequestedAmount,
      resubmitCount: bid.resubmitCount,
      expiresAt: bid.expiresAt,
    },
  })

  return success(res, {
    bidId: bid._id,
    status: bid.status,
    resubmitCount: bid.resubmitCount,
    resubmitRequestedAt: bid.resubmitRequestedAt,
    note: bid.resubmitNote,
    resubmitNote: bid.resubmitNote,
    plantNote: bid.resubmitNote,
    priorQuotedAmount,
    requestedBidAmount: bid.resubmitRequestedAmount,
    expiresAt: bid.expiresAt,
    emailFailures,
  }, 'Freight bid resubmit requested')
})
