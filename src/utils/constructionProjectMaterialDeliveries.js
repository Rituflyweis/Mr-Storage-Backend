const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')

const UPCOMING_EXCLUDE_STATUSES = new Set(['draft', 'cancelled', 'delivered'])

/**
 * Rows for construction project detail — "Upcoming Material Delivery" table (plant freight).
 */
const listUpcomingMaterialDeliveries = async (leadId, { limit = 10 } = {}) => {
  const now = new Date()
  const deliveries = await Delivery.find({
    leadId,
    status: { $nin: [...UPCOMING_EXCLUDE_STATUSES] },
    $or: [
      { deliveryDate: { $gte: now } },
      { deliveryDate: null },
    ],
  })
    .sort({ deliveryDate: 1, createdAt: -1 })
    .limit(limit)
    .lean()

  if (!deliveries.length) return []

  const deliveryIds = deliveries.map((d) => d._id)
  const selectedBidIds = deliveries.map((d) => d.selectedCarrierBidId).filter(Boolean)
  const [bids, selectedBids] = await Promise.all([
    FreightBid.find({ deliveryId: { $in: deliveryIds } }).lean(),
    FreightBid.find({ _id: { $in: selectedBidIds } })
      .populate('carrierId', 'carrierName contactName contactPhone contactEmail')
      .lean(),
  ])
  const selectedMap = new Map(selectedBids.map((row) => [String(row._id), row]))

  return deliveries.map((delivery) => {
    const selectedBid = delivery.selectedCarrierBidId
      ? selectedMap.get(String(delivery.selectedCarrierBidId))
      : null
    const carrier = selectedBid?.carrierId

    return {
      deliveryId: delivery._id,
      id: delivery.deliveryNumber,
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      deliveryDate: delivery.deliveryDate,
      pickupDate: delivery.pickupDate,
      timeWindowStart: delivery.timeWindowStart || delivery.pickupTime || '',
      timeWindowEnd: delivery.timeWindowEnd || delivery.deliveryTime || '',
      item: delivery.loadDescription || delivery.description || delivery.materialType || '',
      description: delivery.loadDescription || delivery.description || '',
      carrier: carrier?.carrierName || null,
      carrierId: carrier?._id || null,
      poc: delivery.receivingPoc || carrier?.contactName || '',
      pocPhone: delivery.pickupContactPhone || carrier?.contactPhone || '',
      pocEmail: delivery.receivingPocEmail || carrier?.contactEmail || '',
      loadWeight: delivery.loadWeight,
    }
  })
}

module.exports = {
  listUpcomingMaterialDeliveries,
}
