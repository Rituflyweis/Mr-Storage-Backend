const FreightBid = require('../../models/FreightBid')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { sendFreightBidAwardedEmail, sendFreightBidRejectedEmail } = require('../../services/email/mailer')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

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
  delivery.status = 'carrier_selected'
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
    metadata: { deliveryId: delivery._id, selectedBidId: selectedBid._id, carrierId: selectedBid.carrierId, quotedAmount: selectedBid.quotedAmount },
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
  }, 'Freight bid selected')
})
