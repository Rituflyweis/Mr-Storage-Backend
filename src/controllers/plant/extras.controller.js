const ExcelJS = require('exceljs')
const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Customer = require('../../models/Customer')
const BundlePlan = require('../../models/BundlePlan')
const SMDTItem = require('../../models/SMDTItem')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const PackingList = require('../../models/PackingList')
const Expense = require('../../models/Expense')
const WIPProfit = require('../../models/WIPProfit')
const asyncHandler = require('../../utils/asyncHandler')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const { buildDateFilter } = require('../../utils/dateRange')
const { FREIGHT_BID_STATUSES, DELIVERY_FULFILLMENT_STATUSES } = require('../../config/constants')
// Granular fulfillment steps still roll up into "inTransit" for this coarse calendar stat.
const IN_TRANSIT_ROLLUP_STATUSES = DELIVERY_FULFILLMENT_STATUSES.filter(s => s !== 'delivered')

const computeSavings = async ({ startDate, endDate, status, search, projectId }) => {
  const dateFilter = buildDateFilter({ startDate, endDate })

  const filter = { ...dateFilter, isTerminated: { $ne: true }, quoteValue: { $gt: 0 } }
  if (projectId) filter._id = projectId
  if (search?.trim()) {
    filter.$or = [
      { projectName: { $regex: search.trim(), $options: 'i' } },
      { jobId: { $regex: search.trim(), $options: 'i' } },
    ]
  }

  const leads = await Lead.find(filter)
    .select('projectName jobId quoteValue lifecycleStatus')
    .sort({ createdAt: -1 })
    .lean()

  const leadIds = leads.map(lead => lead._id)

  const [wipEntries, expenseTotals] = await Promise.all([
    WIPProfit.find({ leadId: { $in: leadIds } }).select('leadId currentCost').lean(),
    Expense.aggregate([
      { $match: { leadId: { $in: leadIds }, isActive: true } },
      { $group: { _id: '$leadId', total: { $sum: '$amount' } } },
    ]),
  ])

  const wipCostMap = new Map(wipEntries.map(w => [String(w.leadId), w.currentCost]))
  const expenseCostMap = new Map(expenseTotals.map(e => [String(e._id), e.total]))

  let excludedNoCostData = 0

  const savingsList = leads.map(lead => {
    const leadKey = String(lead._id)
    const actualCost = wipCostMap.has(leadKey) ? wipCostMap.get(leadKey) : expenseCostMap.get(leadKey)

    if (actualCost == null) {
      excludedNoCostData += 1
      return null
    }

    const smdtCost = lead.quoteValue * 0.85
    const savings = smdtCost - actualCost
    const savingsPct = smdtCost > 0 ? +((savings / smdtCost) * 100).toFixed(1) : 0
    const profitLoss = savings > 0 ? 'Profit' : 'Loss'
    const rowStatus = savings > 0 ? 'Good' : 'Over Budget'

    if (status && status !== rowStatus) return null
    return {
      projectName: lead.projectName,
      smdtCost: Math.round(smdtCost),
      actualCost: Math.round(actualCost),
      savings: Math.round(savings),
      savingsPct,
      profitLoss,
      status: rowStatus,
    }
  }).filter(Boolean)

  const totalSavingsThisMonth = savingsList.filter(s => s.savings > 0).reduce((a, b) => a + b.savings, 0)
  const totalLossThisMonth = Math.abs(savingsList.filter(s => s.savings < 0).reduce((a, b) => a + b.savings, 0))

  return { savingsList, excludedNoCostData, totalSavingsThisMonth, totalLossThisMonth }
}

exports.getSavings = asyncHandler(async (req, res) => {
  const { startDate, endDate, status, search, projectId } = req.query
  const { savingsList, excludedNoCostData, totalSavingsThisMonth, totalLossThisMonth } =
    await computeSavings({ startDate, endDate, status, search, projectId })

  return success(res, {
    stats: { totalSavingsThisMonth, totalLossThisMonth },
    savings: savingsList,
    total: savingsList.length,
    excludedNoCostData,
    note: 'actualCost = WIPProfit.currentCost when an admin has entered one for the project, otherwise the sum of that project\'s active Expense records. Projects with neither (excludedNoCostData) are left out rather than shown with a fabricated cost.',
  })
})

exports.exportSavings = asyncHandler(async (req, res) => {
  const { startDate, endDate, status, search, projectId } = req.query
  const { savingsList } = await computeSavings({ startDate, endDate, status, search, projectId })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Savings')

  sheet.columns = [
    { header: 'Project Name', key: 'projectName', width: 28 },
    { header: 'SMDT Cost', key: 'smdtCost', width: 14 },
    { header: 'Actual Cost', key: 'actualCost', width: 14 },
    { header: 'Savings', key: 'savings', width: 14 },
    { header: 'Savings %', key: 'savingsPct', width: 12 },
    { header: 'Profit/Loss', key: 'profitLoss', width: 12 },
    { header: 'Status', key: 'status', width: 14 },
  ]
  sheet.getRow(1).font = { bold: true }

  for (const row of savingsList) sheet.addRow(row)

  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="savings.xlsx"')
  return res.send(buffer)
})

exports.getFreightLoads = asyncHandler(async (req, res) => {
  const { status, search, carrierId, projectId, customerId, materialType, siteLocation, startDate, endDate, page = 1, limit = 20 } = req.query

  const filter = {}
  if (status) filter.status = status
  if (carrierId) filter.carrierId = carrierId
  const dateFilter = buildDateFilter({ startDate, endDate })
  if (dateFilter.createdAt) filter.createdAt = dateFilter.createdAt

  // Every FreightBid, by definition, has already been sent for bidding (the model has no
  // "draft"/pre-send status) — but bids whose Delivery/Lead was later deleted point nowhere,
  // so the frontend "view load" redirect has nothing valid to open. Excluded here.
  const [rawBids, total, statsAgg] = await Promise.all([
    FreightBid.find(filter)
      .populate({
        path: 'deliveryId',
        select: 'leadId materialType pickupLocation deliveryLocation deliveryDate createdAt status',
        populate: { path: 'leadId', select: 'projectName jobId customerId' },
      })
      .populate({ path: 'carrierId', select: 'carrierName phone' })
      .sort({ createdAt: -1 })
      .lean(),
    FreightBid.countDocuments(filter),
    FreightBid.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$quotedAmount' } } },
    ]),
  ])

  let bids = rawBids.filter((b) => b.deliveryId && b.deliveryId.leadId)
  if (projectId) bids = bids.filter((b) => String(b.deliveryId.leadId._id) === String(projectId))
  if (customerId) bids = bids.filter((b) => String(b.deliveryId.leadId.customerId) === String(customerId))
  if (materialType) bids = bids.filter((b) => b.deliveryId?.materialType === materialType)
  if (siteLocation) bids = bids.filter((b) => b.deliveryId?.deliveryLocation === siteLocation)
  // `token` alone isn't human-searchable — search also matches project name/job ID and carrier name.
  if (search?.trim()) {
    const term = search.trim().toLowerCase()
    bids = bids.filter((b) =>
      b.token?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.projectName?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.jobId?.toLowerCase().includes(term) ||
      b.carrierId?.carrierName?.toLowerCase().includes(term)
    )
  }

  const filteredTotal = (projectId || customerId || search || materialType || siteLocation) ? bids.length : total - (rawBids.length - bids.length)
  const paged = bids.slice((parseInt(page) - 1) * parseInt(limit), (parseInt(page) - 1) * parseInt(limit) + parseInt(limit))

  const statMap = Object.fromEntries(statsAgg.map(s => [s._id, { count: s.count, amount: s.amount }]))
  const inTransit = bids.filter((b) => IN_TRANSIT_ROLLUP_STATUSES.includes(b.deliveryId?.status)).length
  const delivered = bids.filter((b) => b.deliveryId?.status === 'delivered').length

  return success(res, {
    stats: {
      totalAwarded:    statMap['selected']?.count || 0,
      inTransit,
      delivered,
      totalSpent:      statMap['selected']?.amount || 0,
      requestedLoads:  statMap['sent']?.count || 0,
      bidsPending:     statMap['submitted']?.count || 0,
    },
    loads: paged,
    total: filteredTotal,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

exports.getAwardedLoads = asyncHandler(async (req, res) => {
  const { search, carrierId, projectId, customerId, startDate, endDate, page = 1, limit = 20 } = req.query

  const filter = { status: 'selected' }
  if (carrierId) filter.carrierId = carrierId
  const dateFilter = buildDateFilter({ startDate, endDate })
  if (dateFilter.createdAt) filter.createdAt = dateFilter.createdAt

  const [rawBids, total, statsAgg, requestedLoads, bidsPending] = await Promise.all([
    FreightBid.find(filter)
      .populate({
        path: 'deliveryId',
        select: 'leadId materialType pickupLocation deliveryLocation deliveryDate status',
        populate: { path: 'leadId', select: 'projectName jobId customerId' },
      })
      .populate({ path: 'carrierId', select: 'carrierName phone contactName' })
      .sort({ selectedAt: -1 })
      .lean(),
    FreightBid.countDocuments(filter),
    FreightBid.aggregate([
      { $match: { status: 'selected' } },
      { $group: {
        _id: null,
        totalAwarded: { $sum: 1 },
        totalSpent:   { $sum: '$quotedAmount' },
      }},
    ]),
    // Same-shaped stat cards as Freight Loads, for parity between the two screens.
    FreightBid.countDocuments({ status: 'sent' }),
    FreightBid.countDocuments({ status: 'submitted' }),
  ])

  let bids = rawBids.filter((b) => b.deliveryId && b.deliveryId.leadId)
  if (projectId) bids = bids.filter((b) => String(b.deliveryId.leadId._id) === String(projectId))
  if (customerId) bids = bids.filter((b) => String(b.deliveryId.leadId.customerId) === String(customerId))
  if (search?.trim()) {
    const term = search.trim().toLowerCase()
    bids = bids.filter((b) =>
      b.token?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.projectName?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.jobId?.toLowerCase().includes(term) ||
      b.carrierId?.carrierName?.toLowerCase().includes(term)
    )
  }

  const filteredTotal = (projectId || customerId || search) ? bids.length : total - (rawBids.length - bids.length)
  const paged = bids.slice((parseInt(page) - 1) * parseInt(limit), (parseInt(page) - 1) * parseInt(limit) + parseInt(limit))

  const inTransit = bids.filter((b) => IN_TRANSIT_ROLLUP_STATUSES.includes(b.deliveryId?.status)).length
  const delivered = bids.filter((b) => b.deliveryId?.status === 'delivered').length

  const s = statsAgg[0] || {}
  return success(res, {
    stats: {
      totalAwarded: s.totalAwarded || 0,
      inTransit,
      delivered,
      totalSpent:   s.totalSpent || 0,
      requestedLoads,
      bidsPending,
    },
    loads: paged,
    total: filteredTotal,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

const generateFreightLoadsExcel = async (bids, sheetName) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = [
    { header: 'Token',        key: 'token',        width: 14 },
    { header: 'Project',      key: 'projectName',   width: 25 },
    { header: 'Job ID',       key: 'jobId',           width: 12 },
    { header: 'Carrier',      key: 'carrierName',      width: 22 },
    { header: 'Material Type', key: 'materialType',      width: 16 },
    { header: 'Site Location', key: 'siteLocation',        width: 22 },
    { header: 'Amount',       key: 'amount',                width: 14 },
    { header: 'Status',       key: 'status',                  width: 14 },
    { header: 'Date',         key: 'date',                      width: 16 },
  ]
  for (const b of bids) {
    sheet.addRow({
      token: b.token || '—',
      projectName: b.deliveryId?.leadId?.projectName || '—',
      jobId: b.deliveryId?.leadId?.jobId || '—',
      carrierName: b.carrierId?.carrierName || '—',
      materialType: b.deliveryId?.materialType || '—',
      siteLocation: b.deliveryId?.deliveryLocation || '—',
      amount: b.quotedAmount || 0,
      status: b.status || '—',
      date: b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—',
    })
  }
  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

// GET /freight-loads/export
exports.exportFreightLoads = asyncHandler(async (req, res) => {
  const { status, carrierId, projectId, customerId, materialType, siteLocation, search, startDate, endDate } = req.query
  const filter = {}
  if (status) filter.status = status
  if (carrierId) filter.carrierId = carrierId
  const dateFilter = buildDateFilter({ startDate, endDate })
  if (dateFilter.createdAt) filter.createdAt = dateFilter.createdAt

  const rawBids = await FreightBid.find(filter)
    .populate({ path: 'deliveryId', select: 'leadId materialType deliveryLocation', populate: { path: 'leadId', select: 'projectName jobId customerId' } })
    .populate({ path: 'carrierId', select: 'carrierName' })
    .sort({ createdAt: -1 })
    .lean()

  let bids = rawBids.filter((b) => b.deliveryId && b.deliveryId.leadId)
  if (projectId) bids = bids.filter((b) => String(b.deliveryId.leadId._id) === String(projectId))
  if (customerId) bids = bids.filter((b) => String(b.deliveryId.leadId.customerId) === String(customerId))
  if (materialType) bids = bids.filter((b) => b.deliveryId?.materialType === materialType)
  if (siteLocation) bids = bids.filter((b) => b.deliveryId?.deliveryLocation === siteLocation)
  if (search?.trim()) {
    const term = search.trim().toLowerCase()
    bids = bids.filter((b) =>
      b.token?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.projectName?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.jobId?.toLowerCase().includes(term) ||
      b.carrierId?.carrierName?.toLowerCase().includes(term)
    )
  }

  const buffer = await generateFreightLoadsExcel(bids, 'Freight Loads')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="freight-loads.xlsx"')
  return res.send(buffer)
})

// GET /awarded-loads/export
exports.exportAwardedLoads = asyncHandler(async (req, res) => {
  const { carrierId, projectId, customerId, search, startDate, endDate } = req.query
  const filter = { status: 'selected' }
  if (carrierId) filter.carrierId = carrierId
  const dateFilter = buildDateFilter({ startDate, endDate })
  if (dateFilter.createdAt) filter.createdAt = dateFilter.createdAt

  const rawBids = await FreightBid.find(filter)
    .populate({ path: 'deliveryId', select: 'leadId materialType deliveryLocation', populate: { path: 'leadId', select: 'projectName jobId customerId' } })
    .populate({ path: 'carrierId', select: 'carrierName' })
    .sort({ selectedAt: -1 })
    .lean()

  let bids = rawBids.filter((b) => b.deliveryId && b.deliveryId.leadId)
  if (projectId) bids = bids.filter((b) => String(b.deliveryId.leadId._id) === String(projectId))
  if (customerId) bids = bids.filter((b) => String(b.deliveryId.leadId.customerId) === String(customerId))
  if (search?.trim()) {
    const term = search.trim().toLowerCase()
    bids = bids.filter((b) =>
      b.token?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.projectName?.toLowerCase().includes(term) ||
      b.deliveryId?.leadId?.jobId?.toLowerCase().includes(term) ||
      b.carrierId?.carrierName?.toLowerCase().includes(term)
    )
  }

  const buffer = await generateFreightLoadsExcel(bids, 'Awarded Loads')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="awarded-loads.xlsx"')
  return res.send(buffer)
})

exports.getFreightLoadFilters = asyncHandler(async (req, res) => {
  const [carrierIds, deliveryIds] = await Promise.all([
    FreightBid.distinct('carrierId'),
    FreightBid.distinct('deliveryId'),
  ])

  const [carriers, deliveries] = await Promise.all([
    carrierIds.length
      ? FreightCarrier.find({ _id: { $in: carrierIds } }).select('carrierName').sort({ carrierName: 1 }).lean()
      : [],
    deliveryIds.length
      ? Delivery.find({ _id: { $in: deliveryIds } }).select('leadId materialType deliveryLocation').lean()
      : [],
  ])

  const materialTypes = [...new Set(deliveries.map((d) => d.materialType).filter(Boolean))].sort()
  const siteLocations = [...new Set(deliveries.map((d) => d.deliveryLocation).filter(Boolean))].sort()

  const leadIds = [...new Set(deliveries.map((d) => String(d.leadId)).filter(Boolean))]
  const leads = leadIds.length
    ? await Lead.find({ _id: { $in: leadIds } }).select('projectName jobId customerId').sort({ projectName: 1 }).lean()
    : []

  const customerIds = [...new Set(leads.map((l) => String(l.customerId)).filter(Boolean))]
  const customers = customerIds.length
    ? await Customer.find({ _id: { $in: customerIds } }).select('firstName lastName').sort({ firstName: 1 }).lean()
    : []

  return success(res, {
    statuses: FREIGHT_BID_STATUSES,
    carriers: carriers.map((c) => ({ _id: c._id, carrierName: c.carrierName })),
    projects: leads.map((l) => ({ _id: l._id, projectName: l.projectName, jobId: l.jobId })),
    customers: customers.map((c) => ({ _id: c._id, name: `${c.firstName} ${c.lastName || ''}`.trim() })),
    materialTypes,
    siteLocations,
    // No schema/data support exists for these Figma filter dimensions yet — vendor filtering
    // would need a per-load vendor join, and priority/internalOwner/channel/colorBy have no
    // backing fields on Delivery at all. Flagging rather than fabricating.
    note: 'vendor, priority, internalOwner, and channel filters are not yet supported — no backing data exists for them.',
  })
})

exports.getDeliveriesCalendar = asyncHandler(async (req, res) => {
  const { month, year, view = 'month', projectId } = req.query
  const now = new Date()
  const targetYear  = parseInt(year)  || now.getFullYear()
  const targetMonth = parseInt(month) || now.getMonth() + 1

  const startDate = new Date(targetYear, targetMonth - 1, 1)
  const endDate   = new Date(targetYear, targetMonth, 0, 23, 59, 59)

  const filter = {
    scheduledDate: { $gte: startDate, $lte: endDate },
    ...(projectId ? { leadId: projectId } : {}),
  }

  const deliveries = await Delivery.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
    .populate({ path: 'carrierId', select: 'carrierName' })
    .sort({ scheduledDate: 1 })
    .lean()

  const calendarMap = {}
  for (const d of deliveries) {
    const dateKey = d.scheduledDate ? new Date(d.scheduledDate).toISOString().split('T')[0] : null
    if (!dateKey) continue
    if (!calendarMap[dateKey]) calendarMap[dateKey] = []
    calendarMap[dateKey].push(d)
  }

  return success(res, {
    year: targetYear,
    month: targetMonth,
    view,
    deliveries,
    calendarMap,
    statusLegend: ['Draft', 'Scheduled', 'Confirmed', 'In Transit', 'Delivered', 'Delayed', 'Cancelled'],
  })
})

exports.getAllDeliveries = asyncHandler(async (req, res) => {
  const { projectId, siteDestination, deliveryStatus, qrScanStatus, transporter, driver, startDate, endDate, search, page = 1, limit = 10 } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate }, 'scheduledDate')

  const filter = { ...dateFilter }
  if (projectId) filter.leadId = projectId
  if (deliveryStatus) filter.status = deliveryStatus
  // carrierId filter handled via selectedCarrierBidId lookup — skip direct filter
  if (search) {
    filter.$or = [
      { deliveryId: { $regex: search, $options: 'i' } },
      { material: { $regex: search, $options: 'i' } },
    ]
  }

  const statusGroups = await Delivery.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const statusMap = Object.fromEntries(statusGroups.map(s => [s._id, s.count]))

  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId customerId', populate: { path: 'customerId', select: 'firstName lastName' } })
      .populate({ path: 'selectedCarrierBidId', select: 'carrierId quotedAmount', populate: { path: 'carrierId', select: 'carrierName' } })
      .sort({ scheduledDate: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    Delivery.countDocuments(filter),
  ])

  return success(res, {
    stats: {
      draft:     statusMap['draft'] || 0,
      total,
      scheduled: statusMap['scheduled'] || 0,
      confirmed: statusMap['confirmed'] || 0,
      inTransit: IN_TRANSIT_ROLLUP_STATUSES.reduce((sum, s) => sum + (statusMap[s] || 0), 0),
      delivered: statusMap['delivered'] || 0,
      delayed:   statusMap['delayed'] || 0,
      cancelled: statusMap['cancelled'] || 0,
    },
    deliveries,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

const buildQRLabelsFilter = async ({ projectId, search }) => {
  const filter = {}
  if (projectId) filter.leadId = projectId
  if (search?.trim()) {
    const matchingLeads = await Lead.find({
      $or: [{ projectName: { $regex: search.trim(), $options: 'i' } }, { jobId: { $regex: search.trim(), $options: 'i' } }],
    }).select('_id').lean()
    filter.leadId = { $in: matchingLeads.map(l => l._id) }
  }
  return filter
}

exports.getQRLabels = asyncHandler(async (req, res) => {
  const { projectId, search, page = 1, limit = 10 } = req.query
  const filter = await buildQRLabelsFilter({ projectId, search })

  const plans = await BundlePlan.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit))
    .lean()

  const total = await BundlePlan.countDocuments(filter)

  const rows = plans.map(p => ({
    projectId: p.leadId?.jobId || '',
    projectName: p.leadId?.projectName || '',
    qrGeneratedDate: p.createdAt,
    totalQRLabels: p.totalBundles || 0,
    lead: p.leadId,
  }))

  return success(res, { labels: rows, total, page: parseInt(page), limit: parseInt(limit) })
})

// GET /qr-labels/export
exports.exportQRLabelsExcel = asyncHandler(async (req, res) => {
  const { projectId, search } = req.query
  const filter = await buildQRLabelsFilter({ projectId, search })

  const plans = await BundlePlan.find(filter)
    .populate({ path: 'leadId', select: 'projectName jobId' })
    .sort({ createdAt: -1 })
    .lean()

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('QR Labels')
  sheet.columns = [
    { header: 'Project ID', key: 'projectId', width: 14 },
    { header: 'Project Name', key: 'projectName', width: 25 },
    { header: 'QR Generated Date', key: 'qrGeneratedDate', width: 18 },
    { header: 'Total QR Labels', key: 'totalQRLabels', width: 16 },
  ]
  for (const p of plans) {
    sheet.addRow({
      projectId: p.leadId?.jobId || '—',
      projectName: p.leadId?.projectName || '—',
      qrGeneratedDate: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—',
      totalQRLabels: p.totalBundles || 0,
    })
  }
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="qr-labels.xlsx"')
  return res.send(buffer)
})

// These three handlers used to write/read fields (partCode, unitCost, unit, description-as-name)
// that don't exist anywhere on the SMDTItem schema — createItemCost always threw a
// ValidationError (missing required costVersionId/category/partName/partNameNormalized/
// costUnit/mbsCost) and getItemCostList's stats/search silently matched nothing. Rewritten to
// use the real fields, matching the working implementation in common/smdt.controller.js.
const { getActiveCostVersion, cleanStr, normalizeCode } = require('../../services/plant/smdt.service')
const { SMDT_CATEGORIES } = require('../../config/constants')

exports.getItemCostList = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query

  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) {
    return success(res, {
      stats: { totalItemCost: 0, totalItems: 0, newAdded: 0 },
      items: [], total: 0, page: parseInt(page), limit: parseInt(limit),
    })
  }

  const filter = { costVersionId: activeVersion._id, isActive: true }
  if (search) filter.$or = [
    { partName: { $regex: search, $options: 'i' } },
    { description: { $regex: search, $options: 'i' } },
  ]

  const [items, total, statsAgg] = await Promise.all([
    SMDTItem.find(filter)
      .sort({ partName: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    SMDTItem.countDocuments(filter),
    SMDTItem.aggregate([
      { $match: filter },
      { $group: { _id: null, totalCost: { $sum: '$mbsCost' }, count: { $sum: 1 } } },
    ]),
  ])

  const s = statsAgg[0] || {}
  const newAdded = await SMDTItem.countDocuments({
    costVersionId: activeVersion._id,
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  })

  return success(res, {
    stats: { totalItemCost: s.totalCost || 0, totalItems: s.count || 0, newAdded },
    items,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

exports.createItemCost = asyncHandler(async (req, res) => {
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) return badRequest(res, 'No active SMDT cost version. Upload Excel first.')

  const { category, partName, partColor, costUnit, mbsCost, currentMarketCost, description } = req.body
  if (!SMDT_CATEGORIES.includes(category)) {
    return badRequest(res, `Invalid category. Use one of: ${SMDT_CATEGORIES.join(', ')}`)
  }

  const isFrameType = category === 'frames'
  const cleanedPartName = cleanStr(partName)
  if (!cleanedPartName) return badRequest(res, 'partName is required')

  const cleanedColor = isFrameType ? null : (cleanStr(partColor) || '--')
  const partNameNormalized = normalizeCode(cleanedPartName)
  const partColorNormalized = isFrameType ? null : normalizeCode(cleanedColor)

  const duplicate = await SMDTItem.findOne({
    costVersionId: activeVersion._id, category, partNameNormalized, partColorNormalized,
  }).lean()
  if (duplicate) return badRequest(res, 'An item with this category, part name, and color already exists')

  const item = await SMDTItem.create({
    costVersionId: activeVersion._id,
    category,
    partName: cleanedPartName,
    partNameNormalized,
    partColor: cleanedColor,
    partColorNormalized,
    costUnit,
    mbsCost,
    currentMarketCost: currentMarketCost ?? null,
    isFrameType,
    isActive: true,
    description: description || '',
    addedBy: req.user._id,
    lastImportedAt: null,
  })

  return created(res, { item }, 'Item cost added')
})

exports.updateItemCost = asyncHandler(async (req, res) => {
  const item = await SMDTItem.findById(req.params.itemId)
  if (!item) return notFound(res, 'Item not found')

  const { partName, partColor, costUnit, mbsCost, currentMarketCost, description, isActive } = req.body
  if (partName !== undefined) {
    item.partName = cleanStr(partName)
    item.partNameNormalized = normalizeCode(item.partName)
  }
  if (partColor !== undefined && !item.isFrameType) {
    item.partColor = cleanStr(partColor) || '--'
    item.partColorNormalized = normalizeCode(item.partColor)
  }
  if (costUnit !== undefined) item.costUnit = costUnit
  if (mbsCost !== undefined) item.mbsCost = mbsCost
  if (currentMarketCost !== undefined) item.currentMarketCost = currentMarketCost
  if (description !== undefined) item.description = description
  if (isActive !== undefined) item.isActive = isActive
  item.lastUpdatedBy = req.user._id

  await item.save()
  return success(res, { item }, 'Item cost updated')
})

// GET /costing/export
exports.exportItemCostListExcel = asyncHandler(async (req, res) => {
  const { search } = req.query
  const activeVersion = await getActiveCostVersion()
  const filter = activeVersion ? { costVersionId: activeVersion._id, isActive: true } : { _id: null }
  if (search) filter.$or = [
    { partName: { $regex: search, $options: 'i' } },
    { description: { $regex: search, $options: 'i' } },
  ]

  const items = await SMDTItem.find(filter).sort({ partName: 1 }).lean()

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Item Cost List')
  sheet.columns = [
    { header: 'Part Name', key: 'partName', width: 25 },
    { header: 'Part Colour', key: 'partColor', width: 16 },
    { header: 'Cost Unit', key: 'costUnit', width: 12 },
    { header: 'MBS Cost', key: 'mbsCost', width: 14 },
    { header: 'Current Market Cost', key: 'currentMarketCost', width: 18 },
    { header: 'Description', key: 'description', width: 30 },
  ]
  for (const item of items) {
    sheet.addRow({
      partName: item.partName || '—',
      partColor: item.partColor || '—',
      costUnit: item.costUnit || '—',
      mbsCost: item.mbsCost || 0,
      currentMarketCost: item.currentMarketCost ?? '—',
      description: item.description || '',
    })
  }
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="item-cost-list.xlsx"')
  return res.send(buffer)
})

// GET /notification-details
// Delivery-level notification history: who was notified, via what channel, when.
exports.getNotificationDetails = asyncHandler(async (req, res) => {
  const page  = Math.max(1, Number(req.query.page)  || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const skip  = (page - 1) * limit
  const { startDate, endDate, search } = req.query
  const { getScopedLeadIds } = require('../../utils/plantAccessScope')

  const leadIds = await getScopedLeadIds(req)
  if (!leadIds.length) {
    return success(res, { notifications: [], total: 0, page, limit, stats: { total: 0, sent: 0, delivered: 0, pending: 0, failed: 0 } })
  }

  const dateFilter = buildDateFilter({ startDate, endDate }, 'createdAt')
  const deliveryFilter = { leadId: { $in: leadIds }, ...dateFilter }

  if (search) {
    deliveryFilter.$or = [
      { deliveryNumber: { $regex: search, $options: 'i' } },
      { description:    { $regex: search, $options: 'i' } },
    ]
  }

  const deliveries = await Delivery.find(deliveryFilter)
    .populate({ path: 'leadId', select: 'projectName jobId customerId', populate: { path: 'customerId', select: 'firstName lastName email' } })
    .sort({ createdAt: -1 })
    .lean()

  // Build notification rows from delivery status history
  const rows = []
  for (const d of deliveries) {
    const customer = d.leadId?.customerId
    const custName = customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : 'Unknown'
    const custEmail = customer?.email || ''

    for (const h of (d.statusHistory || [{ status: d.status, changedAt: d.createdAt }])) {
      const channel = ['scheduled', 'confirmed'].includes(h.status) ? 'Email' : 'SMS'
      const notifType = h.status === 'bidding_sent' ? 'Bid Request Sent'
        : h.status === 'carrier_selected' ? 'Carrier Selected'
        : h.status === 'scheduled'        ? 'Delivery Scheduled'
        : h.status === 'confirmed'        ? 'Delivery Confirmed'
        : IN_TRANSIT_ROLLUP_STATUSES.includes(h.status) ? 'In Transit Update'
        : h.status === 'delivered'        ? 'Delivery Confirmed'
        : h.status === 'delayed'          ? 'Delay Alert'
        : 'Status Update'
      const deliveryStatus = h.status === 'delivered' ? 'Delivered'
        : h.status === 'cancelled' ? 'Failed'
        : ['scheduled', 'confirmed', ...IN_TRANSIT_ROLLUP_STATUSES].includes(h.status) ? 'Pending'
        : 'Sent'
      rows.push({
        deliveryId:     d._id,
        deliveryNumber: d.deliveryNumber,
        notificationType: notifType,
        channel,
        recipient:      custName,
        recipientEmail: custEmail,
        deliveryStatus,
        sentAt:         h.changedAt || d.createdAt,
        project:        d.leadId?.projectName || d.leadId?.jobId || '',
      })
    }
  }

  rows.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
  const total = rows.length
  const paginated = rows.slice(skip, skip + limit)

  const stats = {
    total,
    sent:      rows.filter(r => r.deliveryStatus === 'Sent').length,
    delivered: rows.filter(r => r.deliveryStatus === 'Delivered').length,
    pending:   rows.filter(r => r.deliveryStatus === 'Pending').length,
    failed:    rows.filter(r => r.deliveryStatus === 'Failed').length,
  }

  return success(res, { notifications: paginated, total, page, limit, stats })
})
