const FreightBid = require('../../models/FreightBid')
const PackingList = require('../../models/PackingList')
const { loadFreightLoadDetailsByLeadId } = require('../plant/freightLoadDetails.service')
const { DELIVERY_FULFILLMENT_STATUSES } = require('../../config/constants')

// Site-facing buckets for the construction app. Plant's fulfillment flow ends at "delivered"
// (truck at site); the site then confirms the receipt → received / partial_received / rejected.
const PRE_ARRIVAL_STATUSES = [
  'carrier_selected', 'scheduled', 'confirmed', 'rescheduled', 'delayed',
  'material_prepared', 'loaded', 'picked_up', 'in_transit',
]
const ON_THE_WAY_STATUSES = ['picked_up', 'in_transit']
const ARRIVED_STATUSES = ['staged', 'dispatched_to_site', 'delivered']
const COMPLETED_STATUSES = ['received', 'partial_received', 'rejected']
const NOT_SCANNABLE_STATUSES = ['draft', 'bidding_sent', 'cancelled', ...COMPLETED_STATUSES]
const ISSUE_STATUSES = ['delayed', 'partial_received', 'rejected']
const ISSUE_OUTCOMES = ['partially_received', 'received_with_issues', 'rejected']
const ARRIVING_SOON_WINDOW_MS = 2 * 60 * 60 * 1000

const DELIVERY_TABS = ['all', 'incoming', 'arrived', 'verification', 'completed', 'issues']

// Mongo filter per tab of the "Deliveries" screen. `receipt.scannedAt: null` also matches
// deliveries created before the receipt sub-document existed.
const TAB_FILTERS = {
  incoming: { status: { $in: PRE_ARRIVAL_STATUSES }, 'receipt.scannedAt': null },
  arrived: { status: { $in: ARRIVED_STATUSES }, 'receipt.scannedAt': null },
  verification: { status: { $nin: NOT_SCANNABLE_STATUSES }, 'receipt.scannedAt': { $ne: null } },
  completed: { status: { $in: COMPLETED_STATUSES } },
  issues: { $or: [{ status: { $in: ISSUE_STATUSES } }, { 'receipt.outcome': { $in: ISSUE_OUTCOMES } }] },
}

const OUTCOME_LABELS = {
  fully_received: 'Completed',
  partially_received: 'Partially Received',
  received_with_issues: 'Received with Issues',
  rejected: 'Rejected',
}

const STATUS_LABELS = {
  carrier_selected: 'Scheduled',
  scheduled: 'Scheduled',
  confirmed: 'Scheduled',
  rescheduled: 'Rescheduled',
  delayed: 'Delayed',
  material_prepared: 'At Plant',
  loaded: 'At Plant',
  picked_up: 'On the Way',
  in_transit: 'On the Way',
  staged: 'Arrived',
  dispatched_to_site: 'Arrived',
  delivered: 'Arrived',
  received: 'Completed',
  partial_received: 'Partially Received',
  rejected: 'Rejected',
}

const TIMELINE_LABELS = {
  material_prepared: 'Material Prepared',
  loaded: 'Loaded',
  picked_up: 'Picked Up',
  in_transit: 'In Transit',
  staged: 'Staged',
  dispatched_to_site: 'Dispatched to site',
  delivered: 'Delivered',
}

const BUNDLE_TYPE_LABELS = {
  panels: 'Panels',
  trim: 'Trim',
  framing: 'Framing',
  fasteners: 'Fasteners',
  accessories: 'Accessories',
  mixed: 'Mixed Materials',
  custom: 'Custom',
}

// Combines a date with a free-text time ("14:00", "2:00 PM") into one Date; null if no date.
const combineDateTime = (date, time) => {
  if (!date) return null
  const result = new Date(date)
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (match) {
    let hours = Number(match[1]) % 24
    const meridiem = match[3]?.toLowerCase()
    if (meridiem === 'pm' && hours < 12) hours += 12
    if (meridiem === 'am' && hours === 12) hours = 0
    result.setHours(hours, Number(match[2]), 0, 0)
  }
  return result
}

const getDayRange = (dateParam) => {
  const base = dateParam ? new Date(dateParam) : new Date()
  if (Number.isNaN(base.getTime())) return null
  const start = new Date(base.toDateString())
  return { start, end: new Date(start.getTime() + 86400000) }
}

const lastStatusChange = (delivery, statuses) => [...(delivery.statusHistory || [])]
  .reverse()
  .find((h) => statuses.includes(h.status))?.changedAt || null

const isCompleted = (delivery) => COMPLETED_STATUSES.includes(delivery.status) || !!delivery.receipt?.confirmedAt

const canScanDelivery = (delivery) => !NOT_SCANNABLE_STATUSES.includes(delivery.status) && !delivery.receipt?.confirmedAt

const getStatusLabel = (delivery, now = new Date()) => {
  if (delivery.receipt?.outcome) return OUTCOME_LABELS[delivery.receipt.outcome]
  if (COMPLETED_STATUSES.includes(delivery.status)) return STATUS_LABELS[delivery.status]
  if (delivery.receipt?.scannedAt) return 'Pending Verification'
  if (ON_THE_WAY_STATUSES.includes(delivery.status)) {
    const eta = combineDateTime(delivery.deliveryDate, delivery.deliveryTime)
    if (eta && eta - now <= ARRIVING_SOON_WINDOW_MS) return 'Arriving Soon'
  }
  return STATUS_LABELS[delivery.status] || delivery.status
}

const getMaterialName = (delivery) => delivery.loadDescription || delivery.materialType || delivery.description || ''

const leadIdOf = (delivery) => delivery.leadId?._id || delivery.leadId

// Delivery has no direct packing-list link; same per-project fallback the delivery PDFs use.
const getLoadIdByLead = async (leadIds) => {
  const rows = await PackingList.aggregate([
    { $match: { leadId: { $in: leadIds } } },
    { $sort: { packingListNo: 1 } },
    { $group: { _id: '$leadId', packingListNo: { $first: '$packingListNo' } } },
  ])
  return new Map(rows.map((r) => [String(r._id), r.packingListNo]))
}

const getCarrierByBid = async (deliveries) => {
  const bidIds = deliveries.map((d) => d.selectedCarrierBidId).filter(Boolean)
  if (!bidIds.length) return new Map()
  const bids = await FreightBid.find({ _id: { $in: bidIds } })
    .populate('carrierId', 'carrierName contactName phone')
    .select('carrierId')
    .lean()
  return new Map(bids.map((b) => [String(b._id), b.carrierId || null]))
}

// Dedicated driver fields win; the carrier's contact person is the fallback until plant fills them.
const buildDriver = (delivery, carrier) => {
  const name = delivery.driverName || carrier?.contactName || ''
  const phone = delivery.driverPhone || carrier?.phone || ''
  return name || phone ? { name, phone } : null
}

const buildTrackingFields = (delivery, { carrier, loadId, now }) => ({
  deliveryId: delivery._id,
  deliveryNumber: delivery.deliveryNumber,
  materialName: getMaterialName(delivery),
  materialType: delivery.materialType || '',
  loadId: loadId || null,
  status: delivery.status,
  statusLabel: getStatusLabel(delivery, now),
  quantity: delivery.packageCount,
  departureFromPlant: lastStatusChange(delivery, ['picked_up'])
    || lastStatusChange(delivery, ['in_transit'])
    || combineDateTime(delivery.pickupDate, delivery.pickupTime),
  arrivalAtSite: combineDateTime(delivery.deliveryDate, delivery.deliveryTime),
  driver: buildDriver(delivery, carrier),
  vehicleNumber: delivery.vehicleNumber || '',
  carrierName: carrier?.carrierName || '',
  canScan: canScanDelivery(delivery),
  verification: {
    scannedAt: delivery.receipt?.scannedAt || null,
    outcome: delivery.receipt?.outcome || null,
    confirmedAt: delivery.receipt?.confirmedAt || null,
  },
})

// Card fields for the "Deliveries" list / Home incoming list, batched across deliveries.
const buildTrackingCards = async (deliveries, now = new Date()) => {
  const leadIds = [...new Map(deliveries.map((d) => [String(leadIdOf(d)), leadIdOf(d)])).values()]
  const [carrierByBid, loadIdByLead] = await Promise.all([getCarrierByBid(deliveries), getLoadIdByLead(leadIds)])
  return deliveries.map((d) => buildTrackingFields(d, {
    carrier: d.selectedCarrierBidId ? carrierByBid.get(String(d.selectedCarrierBidId)) : null,
    loadId: loadIdByLead.get(String(leadIdOf(d))),
    now,
  }))
}

const buildTimeline = (delivery) => {
  const firstReached = (status) => (delivery.statusHistory || []).find((h) => h.status === status)?.changedAt || null
  const steps = DELIVERY_FULFILLMENT_STATUSES
  const done = isCompleted(delivery)
  const currentIndex = done ? steps.length : steps.indexOf(delivery.status)

  const timeline = steps.map((status, index) => {
    const reachedAt = firstReached(status)
    return {
      key: status,
      label: TIMELINE_LABELS[status] || status,
      date: reachedAt,
      completed: !!reachedAt || index <= currentIndex,
    }
  })

  timeline.push({
    key: 'received',
    label: delivery.receipt?.outcome ? OUTCOME_LABELS[delivery.receipt.outcome] : 'Received at Site',
    date: delivery.receipt?.confirmedAt || lastStatusChange(delivery, COMPLETED_STATUSES),
    completed: done,
  })
  return timeline
}

// Bundles on a delivery's load — the project's latest bundle plan, same as the delivery PDFs.
const getDeliveryBundles = async (delivery) => {
  const { bundles, packingLists } = await loadFreightLoadDetailsByLeadId(leadIdOf(delivery))
  const receiptByBundle = new Map((delivery.receipt?.items || []).map((i) => [String(i.bundleId), i]))

  return {
    packingLists,
    bundles: bundles.map((b) => {
      const received = receiptByBundle.get(String(b._id))
      return {
        bundleId: b._id,
        bundleNo: b.bundleNo,
        material: b.title || BUNDLE_TYPE_LABELS[b.bundleType] || b.bundleType || '',
        bundleType: b.bundleType,
        expectedUnits: b.totalQty || 0,
        itemCount: b.itemCount || 0,
        totalWeight: b.totalWeight,
        receivedUnits: received ? received.receivedQty : null,
        verification: received ? received.quantityStatus : 'pending',
      }
    }),
  }
}

const buildMaterialSummary = (delivery, bundles) => ({
  totalBundles: bundles.length,
  totalItems: bundles.reduce((sum, b) => sum + (b.itemCount || 0), 0),
  totalUnits: bundles.reduce((sum, b) => sum + (b.expectedUnits || 0), 0),
  verificationStatus: delivery.receipt?.confirmedAt ? 'completed' : 'pending',
})

const buildWeightAndMaterial = (delivery, bundles) => ({
  weightLbs: delivery.loadWeight ?? (bundles.reduce((sum, b) => sum + Number(b.totalWeight || 0), 0) || null),
  units: delivery.packageCount ?? bundles.reduce((sum, b) => sum + (b.expectedUnits || 0), 0),
  materialType: delivery.materialType || '',
  packaging: delivery.description || '',
})

const buildDocuments = (delivery) => {
  const base = `/api/construction/deliveries/${delivery._id}/download`
  const docs = [
    { type: 'packing_list', name: 'Packing List', url: `${base}/packing-list` },
    { type: 'bill_of_lading', name: 'Bill of Lading', url: `${base}/bill-of-lading` },
  ]
  if (delivery.receipt?.confirmedAt) docs.push({ type: 'receipt', name: 'Material Receipt', url: `${base}/receipt` })
  return docs
}

const buildReceiptSummary = (delivery) => {
  const receipt = delivery.receipt || {}
  if (!receipt.confirmedAt) return null
  return {
    outcome: receipt.outcome,
    outcomeLabel: OUTCOME_LABELS[receipt.outcome],
    deliveryStatus: delivery.status,
    totalExpected: receipt.totalExpected,
    totalReceived: receipt.totalReceived,
    shortQty: receipt.shortQty,
    excessQty: receipt.excessQty,
    notes: receipt.notes,
    items: (receipt.items || []).map((i) => ({
      bundleId: i.bundleId,
      bundleNo: i.bundleNo,
      material: i.material,
      expectedQty: i.expectedQty,
      receivedQty: i.receivedQty,
      quantityStatus: i.quantityStatus,
    })),
    confirmedAt: receipt.confirmedAt,
    confirmedBy: receipt.confirmedBy,
  }
}

module.exports = {
  PRE_ARRIVAL_STATUSES,
  ARRIVED_STATUSES,
  COMPLETED_STATUSES,
  ISSUE_STATUSES,
  ISSUE_OUTCOMES,
  DELIVERY_TABS,
  TAB_FILTERS,
  OUTCOME_LABELS,
  combineDateTime,
  getDayRange,
  lastStatusChange,
  isCompleted,
  canScanDelivery,
  getStatusLabel,
  getMaterialName,
  getCarrierByBid,
  getLoadIdByLead,
  buildDriver,
  buildTrackingCards,
  buildTimeline,
  getDeliveryBundles,
  buildMaterialSummary,
  buildWeightAndMaterial,
  buildDocuments,
  buildReceiptSummary,
}
