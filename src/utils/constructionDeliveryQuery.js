const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const FreightCarrier = require('../models/FreightCarrier')
const { buildDateFilter } = require('./dateRange')
const { findLeadIdsByConstructionSearch } = require('./constructionListQuery')
const { DELIVERY_STATUSES } = require('../config/constants')

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
  } = query

  const dateFilter = buildDateFilter({ startDate, endDate }, 'deliveryDate')
  const filter = { status: { $ne: 'draft' }, ...dateFilter }

  const statusVal = deliveryStatus || status
  if (statusVal) filter.status = statusVal

  const project = projectId || leadId
  if (project) filter.leadId = project

  if (materialType) filter.materialType = materialType
  if (siteDestination) filter.deliveryLocation = { $regex: siteDestination, $options: 'i' }

  const bidIds = await resolveCarrierBidIds({ transporter, driver })
  if (bidIds) filter.selectedCarrierBidId = { $in: bidIds }

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
}
