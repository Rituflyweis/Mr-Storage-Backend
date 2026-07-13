const POOrder = require('../../models/POOrder')
const Quotation = require('../../models/Quotation')
const BOMJob = require('../../models/BOMJob')
const ShipperRequest = require('../../models/ShipperRequest')
const Vendor = require('../../models/Vendor')
const BundlePlan = require('../../models/BundlePlan')
const PackingListPlan = require('../../models/PackingListPlan')
const PackingList = require('../../models/PackingList')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const { ACTIVE_SHIPPER_REQUEST_STATUSES } = require('../../config/constants')
const { buildDateFilter } = require('../../utils/dateRange')

const getLatestBomJobsForLeadIds = async (leadIds) => {
  if (!leadIds.length) return []
  return BOMJob.aggregate([
    { $match: { leadId: { $in: leadIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$buildingId', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
  ])
}

const getApprovedPlantLeadIds = async (query = {}) => {
  const poFilter = { status: 'approved', ...buildDateFilter(query, 'createdAt') }
  if (query.assignedTo) poFilter.assignedTo = query.assignedTo
  return POOrder.distinct('leadId', poFilter)
}

const resolveLeadScope = async (query = {}) => {
  const leadIds = await getApprovedPlantLeadIds(query)
  return { leadIds, isEmpty: !leadIds.length }
}

const fetchApprovedShipperVendorByLeadIds = async (leadIds) => {
  if (!leadIds.length) return new Map()

  const requests = await ShipperRequest.find({
    leadId: { $in: leadIds },
    status: 'approved',
  })
    .populate('vendorId', 'vendorName vendorCode')
    .sort({ reviewedAt: -1, updatedAt: -1 })
    .lean()

  const map = new Map()
  for (const row of requests) {
    const key = String(row.leadId)
    if (!map.has(key) && row.vendorId) {
      map.set(key, row.vendorId)
    }
  }
  return map
}

const fetchLatestBundlePlanByLeadIds = async (leadIds) => {
  if (!leadIds.length) return new Map()

  const rows = await BundlePlan.find({
    leadId: { $in: leadIds },
    status: { $ne: 'cancelled' },
  })
    .select('_id leadId planNumber status')
    .sort({ updatedAt: -1 })
    .lean()

  const map = new Map()
  for (const row of rows) {
    const key = String(row.leadId)
    if (!map.has(key)) map.set(key, row)
  }
  return map
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

const buildOrderProgressReview = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return {
      quotationsSent: 0,
      uploadedBom: 0,
      sentToShipper: 0,
      loadsPlanned: 0,
      shippedQuantity: 0,
    }
  }

  const [quotationsSent, latestJobs, sentToShipper, loadsPlanned, shippedQuantity] = await Promise.all([
    Quotation.countDocuments({ leadId: { $in: leadIds }, status: 'sent' }),
    getLatestBomJobsForLeadIds(leadIds),
    ShipperRequest.countDocuments({ leadId: { $in: leadIds }, sentAt: { $ne: null } }),
    BundlePlan.countDocuments({ leadId: { $in: leadIds }, status: { $ne: 'cancelled' } }),
    PackingList.countDocuments({
      leadId: { $in: leadIds },
      status: { $in: ['dispatched', 'delivered'] },
    }),
  ])

  return {
    quotationsSent,
    uploadedBom: latestJobs.length,
    sentToShipper,
    loadsPlanned,
    shippedQuantity,
  }
}

const buildLoadPlanningStatus = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return {
      loadsPlanning: 0,
      plannedCount: 0,
      readyToShip: 0,
      dispatch: 0,
    }
  }

  const [loadsPlanning, plannedCount, readyToShip, dispatch] = await Promise.all([
    BundlePlan.countDocuments({
      leadId: { $in: leadIds },
      status: { $in: ['draft', 'generated'] },
    }),
    BundlePlan.countDocuments({
      leadId: { $in: leadIds },
      status: 'confirmed',
    }),
    PackingListPlan.countDocuments({
      leadId: { $in: leadIds },
      status: 'confirmed',
    }),
    PackingList.countDocuments({
      leadId: { $in: leadIds },
      status: { $in: ['dispatched', 'delivered'] },
    }),
  ])

  return {
    loadsPlanning,
    plannedCount,
    readyToShip,
    dispatch,
  }
}

const buildShipperQuotationSummary = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return { requested: 0, quoted: 0, pending: 0 }
  }

  const requests = await ShipperRequest.find({ leadId: { $in: leadIds } })
    .select('status submittedAt quoteValue')
    .lean()

  let requested = 0
  let quoted = 0
  let pending = 0

  for (const row of requests) {
    requested += 1
    const hasQuote = Boolean(row.submittedAt) || row.quoteValue != null
    if (hasQuote || ['submitted', 'comparison_processing', 'comparison_completed', 'comparison_failed', 'approved', 'resubmit_requested'].includes(row.status)) {
      quoted += 1
    } else if (row.status === 'sent') {
      pending += 1
    }
  }

  return { requested, quoted, pending }
}

const buildPackingListSummary = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return { generated: 0, inProgress: 0, pending: 0 }
  }

  const [generated, inProgress, approvedShipperLeadIds, packingListPlanLeadIds] = await Promise.all([
    PackingListPlan.countDocuments({
      leadId: { $in: leadIds },
      status: { $in: ['generated', 'confirmed'] },
    }),
    PackingList.countDocuments({
      leadId: { $in: leadIds },
      status: 'draft',
    }),
    ShipperRequest.distinct('leadId', { leadId: { $in: leadIds }, status: 'approved' }),
    PackingListPlan.distinct('leadId', {
      leadId: { $in: leadIds },
      status: { $ne: 'cancelled' },
    }),
  ])

  const planLeadIdSet = new Set(packingListPlanLeadIds.map(String))
  const pending = approvedShipperLeadIds.filter((id) => !planLeadIdSet.has(String(id))).length

  return { generated, inProgress, pending }
}

const buildQrLabelsSummary = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return { generated: 0, inProgress: 0, pending: 0 }
  }

  const [generated, inProgress, planLeadIds, packingListLeadIds] = await Promise.all([
    PackingList.countDocuments({
      leadId: { $in: leadIds },
      status: { $in: ['confirmed', 'delivery_created', 'dispatched', 'delivered'] },
    }),
    PackingList.countDocuments({
      leadId: { $in: leadIds },
      status: 'draft',
    }),
    PackingListPlan.distinct('leadId', {
      leadId: { $in: leadIds },
      status: { $in: ['generated', 'confirmed'] },
    }),
    PackingList.distinct('leadId', { leadId: { $in: leadIds } }),
  ])

  const listLeadIdSet = new Set(packingListLeadIds.map(String))
  const pending = planLeadIds.filter((id) => !listLeadIdSet.has(String(id))).length

  return { generated, inProgress, pending }
}

const buildShippersSummary = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)

  const [activeShippers, ordersWithShippers, pendingAssignments] = await Promise.all([
    Vendor.countDocuments({ status: 'active' }),
    isEmpty
      ? Promise.resolve(0)
      : ShipperRequest.distinct('leadId', { leadId: { $in: leadIds } }).then((rows) => rows.length),
    isEmpty
      ? Promise.resolve(0)
      : ShipperRequest.countDocuments({
          leadId: { $in: leadIds },
          status: { $in: ACTIVE_SHIPPER_REQUEST_STATUSES },
        }),
  ])

  return {
    activeShippers,
    ordersWithShippers,
    pendingAssignments,
  }
}

const buildDeliveriesSummary = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return { scheduled: 0, inTransit: 0, delivered: 0 }
  }

  const deliveries = await Delivery.find({ leadId: { $in: leadIds } }).select('status').lean()

  let scheduled = 0
  let inTransit = 0
  let delivered = 0

  for (const row of deliveries) {
    if (['scheduled', 'confirmed', 'carrier_selected'].includes(row.status)) scheduled += 1
    if (['in_transit', 'delayed'].includes(row.status)) inTransit += 1
    if (row.status === 'delivered') delivered += 1
  }

  return { scheduled, inTransit, delivered }
}

const buildUpcomingShipments = async (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20))
  const skip = (page - 1) * limit

  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return { shipments: [], total: 0, page, limit }
  }

  const today = startOfToday()
  const statusFilter = query.status
    ? { status: query.status }
    : {
        status: {
          $in: ['carrier_selected', 'scheduled', 'confirmed', 'in_transit', 'delayed'],
        },
      }

  const deliveryFilter = {
    leadId: { $in: leadIds },
    ...statusFilter,
  }

  if (query.fromDate || query.toDate) {
    deliveryFilter.pickupDate = {}
    if (query.fromDate) {
      const from = new Date(query.fromDate)
      if (!Number.isNaN(from.getTime())) deliveryFilter.pickupDate.$gte = from
    }
    if (query.toDate) {
      const to = new Date(query.toDate)
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999)
        deliveryFilter.pickupDate.$lte = to
      }
    }
    if (!Object.keys(deliveryFilter.pickupDate).length) delete deliveryFilter.pickupDate
  } else {
    deliveryFilter.$or = [
      { pickupDate: { $gte: today } },
      { deliveryDate: { $gte: today } },
      { pickupDate: null, deliveryDate: null },
    ]
  }

  const search = String(query.search || '').trim()
  let searchLeadIds = null
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const matchedLeads = await Lead.find({
      _id: { $in: leadIds },
      $or: [{ projectName: rx }, { jobId: rx }],
    })
      .select('_id')
      .lean()
    searchLeadIds = matchedLeads.map((row) => row._id)
    if (!searchLeadIds.length) {
      return { shipments: [], total: 0, page, limit }
    }
    deliveryFilter.leadId = { $in: searchLeadIds }
  }

  const [deliveries, total] = await Promise.all([
    Delivery.find(deliveryFilter)
      .sort({ pickupDate: 1, deliveryDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Delivery.countDocuments(deliveryFilter),
  ])

  const pageLeadIds = [...new Set(deliveries.map((row) => String(row.leadId)))]
  const [leads, shipperMap, bundlePlanMap] = await Promise.all([
    Lead.find({ _id: { $in: pageLeadIds } }).select('_id jobId projectName').lean(),
    fetchApprovedShipperVendorByLeadIds(pageLeadIds),
    fetchLatestBundlePlanByLeadIds(pageLeadIds),
  ])

  const leadMap = new Map(leads.map((row) => [String(row._id), row]))

  const shipments = deliveries.map((delivery) => {
    const lead = leadMap.get(String(delivery.leadId))
    const shipper = shipperMap.get(String(delivery.leadId)) || null
    const bundlePlan = bundlePlanMap.get(String(delivery.leadId)) || null

    return {
      deliveryId: delivery._id,
      orderId: lead?.jobId || '',
      leadId: delivery.leadId,
      projectName: lead?.projectName || '',
      shipper: shipper
        ? {
            vendorId: shipper._id,
            vendorName: shipper.vendorName || '',
            vendorCode: shipper.vendorCode || '',
          }
        : null,
      loadPlanId: bundlePlan?._id || null,
      loadPlanNumber: bundlePlan?.planNumber || '',
      shipDate: delivery.pickupDate || null,
      estDeliveryDate: delivery.deliveryDate || null,
      deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
      status: delivery.status,
      deliveryNumber: delivery.deliveryNumber || '',
    }
  })

  return { shipments, total, page, limit }
}

module.exports = {
  getApprovedPlantLeadIds,
  buildOrderProgressReview,
  buildLoadPlanningStatus,
  buildShipperQuotationSummary,
  buildPackingListSummary,
  buildQrLabelsSummary,
  buildShippersSummary,
  buildDeliveriesSummary,
  buildUpcomingShipments,
}
