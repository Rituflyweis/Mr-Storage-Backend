const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const FreightCarrier = require('../models/FreightCarrier')
const { buildDateFilter } = require('./dateRange')
const { findLeadIdsByConstructionSearch } = require('./constructionListQuery')
const { DELIVERY_STATUSES, DELIVERY_FULFILLMENT_STATUSES } = require('../config/constants')

const IN_TRANSIT_ROLLUP_STATUSES = DELIVERY_FULFILLMENT_STATUSES.filter((s) => s !== 'delivered')

const hasDeliveryListFilters = (query = {}) =>
  Boolean(
    query.search?.trim()
    || query.startDate
    || query.endDate
    || query.projectId
    || query.leadId
    || query.materialType
    || query.siteDestination
    || query.transporter
    || query.driver
    || query.status
    || query.deliveryStatus
  )

const computeConstructionDeliveryStats = async (filter, now = new Date()) => {
  const dayStart = new Date(now.toDateString())
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const [inTransit, staged, ready, totalToday] = await Promise.all([
    Delivery.countDocuments({ ...filter, status: { $in: IN_TRANSIT_ROLLUP_STATUSES } }),
    Delivery.countDocuments({ ...filter, status: 'confirmed' }),
    Delivery.countDocuments({ ...filter, status: 'scheduled' }),
    Delivery.countDocuments({
      ...filter,
      deliveryDate: { $gte: dayStart, $lt: dayEnd },
    }),
  ])
  return { inTransit, staged, ready, totalToday }
}

const resolveCarrierBidIds = async ({ transporter, driver }) => {
  if (!transporter && !driver) return null
  const carrierFilter = {}
  if (transporter) carrierFilter.carrierName = { $regex: transporter, $options: 'i' }
  if (driver) carrierFilter.contactName = { $regex: driver, $options: 'i' }

  const carriers = await FreightCarrier.find(carrierFilter).select('_id').lean()
  if (!carriers.length) return []
  const bids = await FreightBid.find({ carrierId: { $in: carriers.map((c) => c._id) } })
    .select('_id')
    .lean()
  return bids.map((b) => b._id)
}

const buildConstructionDeliveryFilter = async (query = {}) => {
  const {
    status,
    deliveryStatus,
    leadId,
    projectId,
    materialType,
    siteDestination,
    transporter,
    driver,
    search,
    startDate,
    endDate,
    includeDrafts,
  } = query

  const dateFilter = buildDateFilter({ startDate, endDate }, 'deliveryDate')
  const filter = { ...dateFilter }
  if (!includeDrafts && includeDrafts !== 'true') {
    filter.status = { $ne: 'draft' }
  }

  const statusVal = deliveryStatus || status
  if (statusVal) filter.status = statusVal

  const project = projectId || leadId
  if (project) filter.leadId = project

  if (materialType) filter.materialType = materialType
  if (siteDestination) filter.deliveryLocation = { $regex: siteDestination, $options: 'i' }

  if (transporter || driver) {
    const bidIds = await resolveCarrierBidIds({ transporter, driver })
    if (!bidIds.length) filter._id = { $in: [] }
    else filter.selectedCarrierBidId = { $in: bidIds }
  }

  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    const orClause = [
      { deliveryNumber: regex },
      { materialType: regex },
      { description: regex },
      { loadDescription: regex },
      { deliveryLocation: regex },
      { receivingPoc: regex },
    ]
    const leadIds = await findLeadIdsByConstructionSearch(search)
    if (leadIds.length) orClause.push({ leadId: { $in: leadIds } })
    filter.$or = orClause
  }

  return filter
}

const getDeliveryFilterOptions = async () => {
  const [siteDestinations, carriers] = await Promise.all([
    Delivery.distinct('deliveryLocation', { deliveryLocation: { $ne: '' } }),
    FreightCarrier.find().select('carrierName contactName').lean(),
  ])

  return {
    deliveryStatuses: DELIVERY_STATUSES.filter((s) => s !== 'draft'),
    siteDestinations,
    transporters: [...new Set(carriers.map((c) => c.carrierName).filter(Boolean))],
    drivers: [...new Set(carriers.map((c) => c.contactName).filter(Boolean))],
  }
}

module.exports = {
  buildConstructionDeliveryFilter,
  getDeliveryFilterOptions,
  resolveCarrierBidIds,
  hasDeliveryListFilters,
  computeConstructionDeliveryStats,
  IN_TRANSIT_ROLLUP_STATUSES,
}
