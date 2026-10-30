const POOrder = require('../../models/POOrder')
const Quotation = require('../../models/Quotation')
const BOMJob = require('../../models/BOMJob')
const ShipperRequest = require('../../models/ShipperRequest')
const QuoteComparisonResult = require('../../models/QuoteComparisonResult')
const Vendor = require('../../models/Vendor')
const BundlePlan = require('../../models/BundlePlan')
const PackingListPlan = require('../../models/PackingListPlan')
const PackingList = require('../../models/PackingList')
const Delivery = require('../../models/Delivery')
const Lead = require('../../models/Lead')
const BundleMismatchOrder = require('../../models/BundleMismatchOrder')
const { ACTIVE_SHIPPER_REQUEST_STATUSES, DELIVERY_FULFILLMENT_STATUSES } = require('../../config/constants')
// Granular fulfillment steps still read as "in transit" on this coarse dashboard rollup.
const DASHBOARD_IN_TRANSIT_STATUSES = new Set([...DELIVERY_FULFILLMENT_STATUSES.filter(s => s !== 'delivered'), 'delayed'])
const { buildDateFilter } = require('../../utils/dateRange')

/** Construction site delivery mismatches still open (not resolved/closed). */
const ACTIVE_DELIVERY_MISMATCH_STATUSES = ['open', 'in_review']

/** Admin UI may send employeeId / plantEmployeeId instead of assignedTo (PO plant owner). */
const normalizeDashboardQuery = (query = {}) => {
  const assignedTo =
    query.assignedTo || query.employeeId || query.plantEmployeeId || query.userId || null
  return assignedTo ? { ...query, assignedTo: String(assignedTo) } : query
}

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
  const q = normalizeDashboardQuery(query)
  const poFilter = { status: 'approved', ...buildDateFilter(q, 'createdAt') }
  if (q.assignedTo) poFilter.assignedTo = q.assignedTo
  return POOrder.distinct('leadId', poFilter)
}

const resolveLeadScope = async (query = {}) => {
  const leadIds = await getApprovedPlantLeadIds(query)
  return { leadIds, isEmpty: !leadIds.length }
}

const emptyMismatchSummary = () => ({
  missingItems: 0,
  quantityMismatches: 0,
  specificationMismatches: 0,
  extraItems: 0,
  missingItemsFromQuote: 0,
  qtyMismatches: 0,
  specMismatches: 0,
  extraItemsInShipper: 0,
  /** Construction site delivery mismatch orders (BundleMismatchOrder). */
  deliveryMismatches: 0,
  constructionDeliveryMismatches: 0,
  deliveryMismatchItems: 0,
  totalComparedLines: 0,
  statusBreakdown: {},
})

const countDeliveryMismatchesForLeads = async (leadIds = []) => {
  if (!leadIds.length) {
    return { deliveryMismatches: 0, deliveryMismatchItems: 0, byReason: {} }
  }
  const orders = await BundleMismatchOrder.find({
    leadId: { $in: leadIds },
    status: { $in: ACTIVE_DELIVERY_MISMATCH_STATUSES },
  })
    .select('reason items status')
    .lean()

  const byReason = {}
  let deliveryMismatchItems = 0
  for (const o of orders) {
    const reason = String(o.reason || 'unspecified').trim() || 'unspecified'
    byReason[reason] = (byReason[reason] || 0) + 1
    deliveryMismatchItems += Array.isArray(o.items) ? o.items.length : 0
  }
  return {
    deliveryMismatches: orders.length,
    deliveryMismatchItems,
    byReason,
  }
}

const buildMismatchSummary = async (query = {}) => {
  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) return emptyMismatchSummary()

  const deliveryStats = await countDeliveryMismatchesForLeads(leadIds)

  const requestIds = await ShipperRequest.distinct('_id', {
    leadId: { $in: leadIds },
    comparisonStatus: 'completed',
  })

  const counts = {}
  if (requestIds.length) {
    const grouped = await QuoteComparisonResult.aggregate([
      { $match: { shipperRequestId: { $in: requestIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    for (const row of grouped) counts[row._id] = row.count
  }

  const missingItems = counts.missing_in_vendor_quote || 0
  const quantityMismatches = counts.qty_mismatch || 0
  const specificationMismatches =
    (counts.part_mismatch || 0) +
    (counts.length_mismatch || 0) +
    (counts.weight_mismatch || 0) +
    (counts.ambiguous_match || 0) +
    (counts.price_mismatch || 0)
  const extraItems = counts.extra_in_vendor_quote || 0
  const totalComparedLines = Object.values(counts).reduce((s, n) => s + n, 0)

  return {
    missingItems,
    quantityMismatches,
    specificationMismatches,
    extraItems,
    missingItemsFromQuote: missingItems,
    qtyMismatches: quantityMismatches,
    specMismatches: specificationMismatches,
    extraItemsInShipper: extraItems,
    deliveryMismatches: deliveryStats.deliveryMismatches,
    constructionDeliveryMismatches: deliveryStats.deliveryMismatches,
    deliveryMismatchItems: deliveryStats.deliveryMismatchItems,
    totalComparedLines,
    statusBreakdown: {
      ...counts,
      delivery_mismatch: deliveryStats.deliveryMismatches,
      ...Object.fromEntries(
        Object.entries(deliveryStats.byReason || {}).map(([k, v]) => [
          `delivery_${k}`,
          v,
        ]),
      ),
    },
  }
}

const mapDeliveryMismatchReportRow = (order = {}) => {
  const lead = order.leadId && typeof order.leadId === 'object' ? order.leadId : null
  const items = Array.isArray(order.items) ? order.items : []
  const expectedQty = items.reduce((s, i) => s + (Number(i.expectedQty) || 0), 0)
  const receivedQty = items.reduce((s, i) => s + (Number(i.receivedQty) || 0), 0)
  return {
    resultId: order._id,
    source: 'delivery_mismatch',
    mismatchId: order._id,
    mismatchOrderId: order.mismatchOrderId || '',
    shipperRequestId: null,
    leadId: lead?._id || order.leadId,
    projectName: lead?.projectName || '',
    jobId: lead?.jobId || '',
    vendorName: '',
    vendorCode: '',
    fileName: '',
    bundleId: order.bundleId?._id || order.bundleId || null,
    bundleNo: order.bundleNo || order.bundleId?.bundleNo || '',
    status: 'delivery_mismatch',
    orderStatus: order.status,
    severity: 'high',
    reason: order.reason || order.notes || 'Construction delivery mismatch',
    expected: { qty: expectedQty, items },
    received: { qty: receivedQty, items },
    items,
    photos: order.photos || [],
    reportedBy: order.reportedBy
      ? {
          _id: order.reportedBy._id,
          name: order.reportedBy.name,
          email: order.reportedBy.email,
        }
      : null,
    createdAt: order.createdAt,
  }
}

const loadDeliveryMismatchReportRows = async (leadIds, query = {}) => {
  const filter = {
    leadId: { $in: leadIds },
    status: { $in: ACTIVE_DELIVERY_MISMATCH_STATUSES },
  }
  const search = String(query.search || '').trim()
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [
      { reason: rx },
      { notes: rx },
      { mismatchOrderId: rx },
      { bundleNo: rx },
    ]
  }

  const rows = await BundleMismatchOrder.find(filter)
    .populate('leadId', 'projectName jobId')
    .populate('bundleId', 'bundleNo')
    .populate('reportedBy', 'name email')
    .sort({ createdAt: -1 })
    .lean()

  return rows.map(mapDeliveryMismatchReportRow)
}

const buildMismatchReport = async (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20))
  const skip = (page - 1) * limit
  const category = String(query.category || '').toLowerCase().trim()

  const { leadIds, isEmpty } = await resolveLeadScope(query)
  if (isEmpty) {
    return { items: [], total: 0, page, limit }
  }

  const includeQuote =
    !category ||
    ['missing', 'qty', 'spec', 'extra', 'all'].includes(category)
  const includeDelivery =
    !category ||
    category === 'all' ||
    category === 'delivery' ||
    category === 'construction' ||
    // Qty-short site reports also belong under the qty tab.
    category === 'qty'

  let quoteItems = []
  if (includeQuote && category !== 'delivery' && category !== 'construction') {
    const requests = await ShipperRequest.find({
      leadId: { $in: leadIds },
      comparisonStatus: 'completed',
    })
      .select('_id leadId vendorId submittedFileName')
      .populate('leadId', 'projectName jobId')
      .populate('vendorId', 'vendorName vendorCode')
      .lean()

    const requestIds = requests.map((r) => r._id)
    if (requestIds.length) {
      const requestMap = new Map(requests.map((r) => [String(r._id), r]))

      const statusFilter =
        category === 'missing'
          ? ['missing_in_vendor_quote']
          : category === 'qty'
            ? ['qty_mismatch']
            : category === 'spec'
              ? [
                  'part_mismatch',
                  'length_mismatch',
                  'weight_mismatch',
                  'ambiguous_match',
                  'price_mismatch',
                ]
              : category === 'extra'
                ? ['extra_in_vendor_quote']
                : [
                    'missing_in_vendor_quote',
                    'qty_mismatch',
                    'part_mismatch',
                    'length_mismatch',
                    'weight_mismatch',
                    'ambiguous_match',
                    'price_mismatch',
                    'extra_in_vendor_quote',
                  ]

      const match = {
        shipperRequestId: { $in: requestIds },
        status: { $in: statusFilter },
      }
      const search = String(query.search || '').trim()
      if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        match.$or = [{ reason: rx }, { status: rx }]
      }

      const rows = await QuoteComparisonResult.find(match)
        .sort({ createdAt: -1 })
        .lean()

      quoteItems = rows.map((row) => {
        const req = requestMap.get(String(row.shipperRequestId)) || {}
        const lead = req.leadId
        const vendor = req.vendorId
        return {
          resultId: row._id,
          source: 'quote_comparison',
          shipperRequestId: row.shipperRequestId,
          leadId: lead?._id || req.leadId,
          projectName: lead?.projectName || '',
          jobId: lead?.jobId || '',
          vendorName: vendor?.vendorName || '',
          vendorCode: vendor?.vendorCode || '',
          fileName: req.submittedFileName || '',
          status: row.status,
          severity: row.severity,
          reason: row.reason || '',
          expected: row.expected,
          received: row.received,
          createdAt: row.createdAt,
        }
      })
    }
  }

  let deliveryItems = []
  if (includeDelivery) {
    deliveryItems = await loadDeliveryMismatchReportRows(leadIds, query)
    if (category === 'qty') {
      deliveryItems = deliveryItems.filter((r) =>
        /qty|quantity|short/i.test(String(r.reason || '')),
      )
    }
  }

  const merged = [...deliveryItems, ...quoteItems].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  )
  const total = merged.length
  const items = merged.slice(skip, skip + limit)

  return { items, total, page, limit }
}

const buildPlantOverviewExportPayload = async (query = {}) => {
  const [
    orderProgress,
    loadPlanning,
    shipperQuotation,
    packingList,
    qrLabels,
    shippers,
    deliveries,
    mismatchSummary,
  ] = await Promise.all([
    buildOrderProgressReview(query),
    buildLoadPlanningStatus(query),
    buildShipperQuotationSummary(query),
    buildPackingListSummary(query),
    buildQrLabelsSummary(query),
    buildShippersSummary(query),
    buildDeliveriesSummary(query),
    buildMismatchSummary(query),
  ])

  return {
    orderProgress,
    loadPlanning,
    shipperQuotation,
    packingList,
    qrLabels,
    shippers,
    deliveries,
    mismatchSummary,
  }
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
    if (DASHBOARD_IN_TRANSIT_STATUSES.has(row.status)) inTransit += 1
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
          $in: ['carrier_selected', 'scheduled', 'confirmed', ...DELIVERY_FULFILLMENT_STATUSES.filter(s => s !== 'delivered'), 'delayed'],
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
  normalizeDashboardQuery,
  buildOrderProgressReview,
  buildLoadPlanningStatus,
  buildShipperQuotationSummary,
  buildPackingListSummary,
  buildQrLabelsSummary,
  buildShippersSummary,
  buildDeliveriesSummary,
  buildUpcomingShipments,
  buildMismatchSummary,
  buildMismatchReport,
  buildPlantOverviewExportPayload,
}
