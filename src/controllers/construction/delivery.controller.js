const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Bundle = require('../../models/Bundle')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const buildDeliveryCard = async (delivery) => {
  let carrier = null
  if (delivery.selectedCarrierBidId) {
    const bid = await FreightBid.findById(delivery.selectedCarrierBidId)
      .populate('carrierId', 'name phone email')
      .lean()
    if (bid?.carrierId) {
      carrier = {
        name: bid.carrierId.name,
        phone: bid.carrierId.phone,
        email: bid.carrierId.email,
        truckNumber: bid.truckNumber || '',
        driverName: bid.driverName || '',
        driverPhone: bid.driverPhone || '',
      }
    }
  }

  return {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    status: delivery.status,
    description: delivery.description,
    materialType: delivery.materialType,
    loadWeight: delivery.loadWeight,
    packageCount: delivery.packageCount,
    loadingEquipment: delivery.loadingEquipment,
    schedule: {
      pickupDate: delivery.pickupDate,
      pickupTime: delivery.pickupTime,
      deliveryDate: delivery.deliveryDate,
      deliveryTime: delivery.deliveryTime,
      timings: delivery.timings,
    },
    pickupLocation: delivery.pickupLocation,
    deliveryLocation: delivery.deliveryLocation,
    stagingArea: delivery.additionalNotes || '',
    notes: delivery.specialRequirements || '',
    receivingPoc: delivery.receivingPoc,
    pickupContactPhone: delivery.pickupContactPhone,
    carrier,
    project: {
      leadId: delivery.leadId?._id,
      projectName: delivery.leadId?.projectName,
      jobId: delivery.leadId?.jobId,
      location: delivery.leadId?.location,
    },
  }
}

exports.getDeliveries = asyncHandler(async (req, res) => {
  const { status, leadId, page = 1, limit = 20 } = req.query

  const filter = { status: { $ne: 'draft' } }
  if (status) filter.status = status
  if (leadId) filter.leadId = leadId

  const skip = (Number(page) - 1) * Number(limit)
  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate('leadId', 'projectName jobId location')
      .sort({ deliveryDate: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Delivery.countDocuments(filter),
  ])

  const now = new Date()
  const stats = {
    inTransit: await Delivery.countDocuments({ status: 'in_transit' }),
    staged: await Delivery.countDocuments({ status: 'confirmed' }),
    ready: await Delivery.countDocuments({ status: 'scheduled' }),
    totalToday: await Delivery.countDocuments({
      status: { $ne: 'draft' },
      deliveryDate: {
        $gte: new Date(now.toDateString()),
        $lt: new Date(new Date(now.toDateString()).getTime() + 86400000),
      },
    }),
  }

  const cards = await Promise.all(deliveries.map(buildDeliveryCard))
  return success(res, { deliveries: cards, total, stats })
})

exports.getDelivery = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
    .populate('leadId', 'projectName jobId location')
    .lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  const card = await buildDeliveryCard(delivery)
  return success(res, { delivery: card })
})

exports.markReceived = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')
  if (delivery.status === 'delivered') return badRequest(res, 'Already marked as delivered')

  delivery.status = 'delivered'
  delivery.statusHistory.push({ status: 'delivered', changedAt: new Date() })
  await delivery.save()

  return success(res, { deliveryId: delivery._id, status: 'delivered' }, 'Marked as received')
})

exports.markPartialReceived = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  delivery.status = 'in_transit'
  delivery.statusHistory.push({ status: 'in_transit', changedAt: new Date() })
  if (req.body.notes) delivery.additionalNotes = req.body.notes
  await delivery.save()

  return success(res, { deliveryId: delivery._id, status: 'in_transit' }, 'Marked as partial received')
})

exports.updateSiteContact = asyncHandler(async (req, res) => {
  const { contactName, contactTitle, phone, email, availableHours, notes } = req.body

  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  delivery.siteContact = {
    contactName: contactName ?? delivery.siteContact?.contactName ?? '',
    contactTitle: contactTitle ?? delivery.siteContact?.contactTitle ?? '',
    phone: phone ?? delivery.siteContact?.phone ?? '',
    email: email ?? delivery.siteContact?.email ?? '',
    availableHours: availableHours ?? delivery.siteContact?.availableHours ?? '',
    notes: notes ?? delivery.siteContact?.notes ?? '',
  }
  await delivery.save()

  return success(res, { deliveryId: delivery._id, siteContact: delivery.siteContact }, 'Site contact updated')
})

exports.scanBundle = asyncHandler(async (req, res) => {
  const { bundleId } = req.body
  if (!bundleId) return badRequest(res, 'bundleId is required')

  const bundle = await Bundle.findOne({
    $or: [{ _id: bundleId.length === 24 ? bundleId : null }, { bundleNo: bundleId }],
  })
    .populate('bundlePlanId', 'leadId')
    .lean()

  if (!bundle) return notFound(res, 'Bundle not found')

  return success(res, {
    bundleId: bundle._id,
    bundleNo: bundle.bundleNo,
    bundleType: bundle.bundleType,
    title: bundle.title,
    totalQty: bundle.totalQty,
    totalWeight: bundle.totalWeight,
    maxLengthFeet: bundle.maxLengthFeet,
    status: bundle.status,
    packingListId: bundle.packingListId,
    items: bundle.items || [],
  })
})
