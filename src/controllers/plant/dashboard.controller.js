const Lead = require('../../models/Lead')
const Building = require('../../models/Building')
const ShipperRequest = require('../../models/ShipperRequest')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const Vendor = require('../../models/Vendor')
const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Bundle = require('../../models/Bundle')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')

const IN_PRODUCTION_STAGES = ['material_check', 'production_planning', 'fabrication_started', 'quality_inspection', 'packing_bundling']

// GET /dashboard — Plant Panel home screen
exports.getDashboard = asyncHandler(async (req, res) => {
  const leadIds = await getScopedLeadIds(req, req.query)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (!leadIds.length) {
    return success(res, {
      stats: { totalProjects: 0, inProduction: 0, readyToDispatch: 0, dispatchedToday: 0, pendingApproval: 0 },
      productionOverviewToday: { plannedTonnage: null, producedTonnage: null, utilizationPct: null, onTimeDeliveryPct: null, reworkRejectionPct: null },
      recentShipperFiles: [],
      plantAlerts: [],
      freightCarriers: [],
      drawingApprovalStatus: [],
    })
  }

  const leadFilter = { _id: { $in: leadIds } }

  const [
    totalProjects, inProduction, readyToDispatch,
    pendingApprovalLeadIds, dispatchedTodayLeads,
    shipperRequests, comparisonFailures, buildings,
  ] = await Promise.all([
    Lead.countDocuments({ ...leadFilter, isTerminated: false }),
    Lead.countDocuments({ ...leadFilter, isTerminated: false, lifecycleStatus: { $in: IN_PRODUCTION_STAGES } }),
    Lead.countDocuments({ ...leadFilter, isTerminated: false, lifecycleStatus: 'ready_for_delivery' }),
    Building.distinct('leadId', { leadId: { $in: leadIds }, drawings: { $elemMatch: { status: 'pending_review' } } }),
    // "Dispatched Today" — stage flipped to 'dispatched' today, per lifecycleHistory.
    Lead.find({ ...leadFilter, lifecycleStatus: 'dispatched' }).select('lifecycleHistory').lean(),
    ShipperRequest.find({ leadId: { $in: leadIds }, submittedAt: { $ne: null } })
      .sort({ submittedAt: -1 }).limit(10)
      .populate('leadId', 'projectName jobId')
      .populate('vendorId', 'name')
      .populate('consolidatedBOMId', 'totalWeight')
      .lean(),
    ShipperRequest.find({ leadId: { $in: leadIds }, comparisonStatus: 'failed' })
      .sort({ comparisonRanAt: -1 }).limit(5)
      .populate('leadId', 'projectName')
      .lean(),
    Building.find({ leadId: { $in: leadIds } }).select('leadId drawings customerId').populate('customerId', 'firstName lastName').lean(),
  ])

  const dispatchedToday = dispatchedTodayLeads.filter((l) =>
    (l.lifecycleHistory || []).some((h) => h.stage === 'dispatched' && new Date(h.changedAt) >= startOfToday)
  ).length

  // "Recent Shipper Files Received" — vendor-submitted shipper files, most recent first.
  const recentShipperFiles = shipperRequests.map((r) => ({
    requestId: r._id,
    projectId: r.leadId?.jobId || '',
    projectName: r.leadId?.projectName || '',
    fileName: r.submittedFileName || '',
    vendorName: r.vendorId?.name || '',
    uploadDate: r.submittedAt,
    rate: r.quoteValue,
    weight: r.consolidatedBOMId?.totalWeight ?? null,
    status: r.status,
  }))

  // "Plant Alerts" — comparison job outcomes + orders that just became ready-to-dispatch.
  const readyForDeliveryLeads = await Lead.find({ ...leadFilter, lifecycleStatus: 'ready_for_delivery' })
    .select('projectName lifecycleHistory').lean()
  const alerts = []
  for (const r of shipperRequests) {
    if (r.comparisonStatus === 'completed') {
      alerts.push({ type: 'comparison_completed', message: `Shipper File Comparison Completed`, refId: r._id, projectName: r.leadId?.projectName || '', occurredAt: r.comparisonRanAt })
    }
  }
  for (const r of comparisonFailures) {
    alerts.push({ type: 'comparison_failed', message: `Shipper File Comparison Failed`, refId: r._id, projectName: r.leadId?.projectName || '', occurredAt: r.comparisonRanAt })
  }
  for (const l of readyForDeliveryLeads) {
    const entry = (l.lifecycleHistory || []).slice().reverse().find((h) => h.stage === 'ready_for_delivery')
    if (entry) alerts.push({ type: 'ready_to_dispatch', message: `Order marked as ready to dispatch`, refId: l._id, projectName: l.projectName, occurredAt: entry.changedAt })
  }
  alerts.sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0))

  // "Freight Carriers" — loads today per carrier, on-time vs delayed.
  const todayDeliveries = await Delivery.find({
    leadId: { $in: leadIds }, deliveryDate: { $gte: startOfToday }, status: { $nin: ['draft', 'cancelled'] },
  }).select('selectedCarrierBidId status').lean()
  const bidIds = todayDeliveries.map((d) => d.selectedCarrierBidId).filter(Boolean)
  const bids = bidIds.length
    ? await FreightBid.find({ _id: { $in: bidIds } }).select('carrierId').populate('carrierId', 'carrierName').lean()
    : []
  const bidCarrierMap = new Map(bids.map((b) => [String(b._id), b.carrierId]))
  const carrierLoadMap = new Map()
  for (const d of todayDeliveries) {
    const carrier = d.selectedCarrierBidId ? bidCarrierMap.get(String(d.selectedCarrierBidId)) : null
    if (!carrier) continue
    const key = String(carrier._id)
    if (!carrierLoadMap.has(key)) carrierLoadMap.set(key, { carrierId: carrier._id, carrierName: carrier.carrierName, loadsToday: 0, delayed: 0 })
    const entry = carrierLoadMap.get(key)
    entry.loadsToday += 1
    if (d.status === 'delayed') entry.delayed += 1
  }
  const freightCarriers = [...carrierLoadMap.values()].map((c) => ({ ...c, status: c.delayed > 0 ? 'Delayed' : 'On Time' }))

  // "Drawing Approval Status" — flattened per-drawing rows across all scoped projects.
  const leadNames = await Lead.find(leadFilter).select('projectName').lean()
  const leadNameMap = new Map(leadNames.map((l) => [String(l._id), l.projectName]))
  const drawingRows = []
  for (const b of buildings) {
    const client = b.customerId ? `${b.customerId.firstName || ''} ${b.customerId.lastName || ''}`.trim() : ''
    for (const d of (b.drawings || [])) {
      drawingRows.push({
        buildingId: b._id,
        client,
        projectName: leadNameMap.get(String(b.leadId)) || '',
        fileName: d.fileName,
        sentDate: d.uploadedAt,
        status: d.status === 'rejected' ? 'revision_sent' : d.status,
      })
    }
  }
  drawingRows.sort((a, b) => new Date(b.sentDate || 0) - new Date(a.sentDate || 0))

  // "Production Overview (Today)" — only On-Time Delivery % and Rework/Rejection % have real
  // backing data. Planned/Produced Tonnage and Utilization % have no fabrication-output or
  // equipment-capacity tracking anywhere in the schema — left null rather than fabricated;
  // building those for real requires a new production-log model, which is a product decision.
  const [deliveredTodayDeliveries, bundlesVerifiedToday] = await Promise.all([
    Delivery.find({
      leadId: { $in: leadIds },
      status: 'delivered',
      'statusHistory': { $elemMatch: { status: 'delivered', changedAt: { $gte: startOfToday } } },
    }).select('deliveryDate statusHistory').lean(),
    Bundle.find({ leadId: { $in: leadIds }, verifiedAt: { $gte: startOfToday } }).select('mismatchItems').lean(),
  ])

  let onTimeDeliveryPct = null
  if (deliveredTodayDeliveries.length) {
    const onTime = deliveredTodayDeliveries.filter((d) => {
      const deliveredEntry = (d.statusHistory || []).slice().reverse().find((h) => h.status === 'delivered')
      if (!deliveredEntry || !d.deliveryDate) return true // no planned date on record — don't penalize
      return new Date(deliveredEntry.changedAt) <= new Date(d.deliveryDate)
    }).length
    onTimeDeliveryPct = Math.round((onTime / deliveredTodayDeliveries.length) * 100 * 10) / 10
  }

  let reworkRejectionPct = null
  if (bundlesVerifiedToday.length) {
    const withMismatch = bundlesVerifiedToday.filter((b) => (b.mismatchItems || []).length > 0).length
    reworkRejectionPct = Math.round((withMismatch / bundlesVerifiedToday.length) * 100 * 10) / 10
  }

  return success(res, {
    stats: {
      totalProjects,
      inProduction,
      readyToDispatch,
      dispatchedToday,
      pendingApproval: pendingApprovalLeadIds.length,
    },
    productionOverviewToday: {
      plannedTonnage: null,  // no fabrication planning data exists
      producedTonnage: null, // no production output tracking exists
      utilizationPct: null,  // no equipment/capacity data exists
      onTimeDeliveryPct,
      reworkRejectionPct,
    },
    recentShipperFiles,
    plantAlerts: alerts.slice(0, 10),
    freightCarriers,
    drawingApprovalStatus: drawingRows.slice(0, 20),
  })
})
