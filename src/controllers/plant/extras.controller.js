const ExcelJS = require('exceljs')
const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const BundlePlan = require('../../models/BundlePlan')
const SMDTItem = require('../../models/SMDTItem')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const PackingList = require('../../models/PackingList')
const Expense = require('../../models/Expense')
const WIPProfit = require('../../models/WIPProfit')
const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound } = require('../../utils/apiResponse')
const { buildDateFilter } = require('../../utils/dateRange')

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
  const { status, search, carrierId, projectId, customerId, startDate, endDate, page = 1, limit = 20 } = req.query

  const filter = {}
  if (status) filter.status = status
  if (carrierId) filter.carrierId = carrierId
  if (search) filter.$or = [
    { token: { $regex: search, $options: 'i' } },
  ]
  const dateFilter = buildDateFilter({ startDate, endDate })
  if (dateFilter.createdAt) filter.createdAt = dateFilter.createdAt

  // Every FreightBid, by definition, has already been sent for bidding (the model has no
  // "draft"/pre-send status) — but bids whose Delivery/Lead was later deleted point nowhere,
  // so the frontend "view load" redirect has nothing valid to open. Excluded here.
  const [rawBids, total, statsAgg] = await Promise.all([
    FreightBid.find(filter)
      .populate({
        path: 'deliveryId',
        select: 'leadId material pickupLocation dropoffLocation scheduledDate requestedAt',
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

  const filteredTotal = (projectId || customerId) ? bids.length : total - (rawBids.length - bids.length)
  const paged = bids.slice((parseInt(page) - 1) * parseInt(limit), (parseInt(page) - 1) * parseInt(limit) + parseInt(limit))

  const statMap = Object.fromEntries(statsAgg.map(s => [s._id, { count: s.count, amount: s.amount }]))

  return success(res, {
    stats: {
      totalAwarded:    statMap['selected']?.count || 0,
      inTransit:       0,
      delivered:       0,
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
  const { search, page = 1, limit = 20 } = req.query

  const filter = { status: 'selected' }

  const [bids, total, statsAgg] = await Promise.all([
    FreightBid.find(filter)
      .populate({
        path: 'deliveryId',
        select: 'leadId material pickupLocation dropoffLocation scheduledDate status',
        populate: { path: 'leadId', select: 'projectName jobId' },
      })
      .populate({ path: 'carrierId', select: 'carrierName phone contactName' })
      .sort({ selectedAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
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
  ])

  const s = statsAgg[0] || {}
  return success(res, {
    stats: {
      totalAwarded: s.totalAwarded || 0,
      inTransit:    0,
      delivered:    0,
      totalSpent:   s.totalSpent || 0,
    },
    loads: bids,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
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
      inTransit: statusMap['in_transit'] || 0,
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

exports.getQRLabels = asyncHandler(async (req, res) => {
  const { projectId, search, page = 1, limit = 10 } = req.query

  const filter = projectId ? { leadId: projectId } : {}

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

exports.getItemCostList = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query

  const filter = {}
  if (search) filter.$or = [
    { partCode: { $regex: search, $options: 'i' } },
    { description: { $regex: search, $options: 'i' } },
  ]

  const [items, total, statsAgg] = await Promise.all([
    SMDTItem.find(filter)
      .sort({ partCode: 1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    SMDTItem.countDocuments(filter),
    SMDTItem.aggregate([
      { $group: { _id: null, totalCost: { $sum: '$unitCost' }, count: { $sum: 1 } } },
    ]),
  ])

  const s = statsAgg[0] || {}

  const newAdded = await SMDTItem.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })

  return success(res, {
    stats: { totalItemCost: s.totalCost || 0, totalItems: s.count || 0, newAdded },
    items,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  })
})

exports.createItemCost = asyncHandler(async (req, res) => {
  const { partName, partColor, costUnit, mbsCost, currentMarketCost, description } = req.body

  const item = await SMDTItem.create({
    partCode: `PART-${Date.now()}`,
    description: partName || description || '',
    unitCost: mbsCost || 0,
    unit: costUnit || 'FT',
  })

  return success(res, { item })
})

exports.updateItemCost = asyncHandler(async (req, res) => {
  const item = await SMDTItem.findById(req.params.itemId)
  if (!item) return notFound(res, 'Item not found')

  const { partName, partColor, costUnit, mbsCost, currentMarketCost, description } = req.body
  if (partName || description) item.description = partName || description
  if (mbsCost !== undefined) item.unitCost = mbsCost
  if (costUnit) item.unit = costUnit

  await item.save()
  return success(res, { item })
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
        : h.status === 'in_transit'       ? 'In Transit Update'
        : h.status === 'delivered'        ? 'Delivery Confirmed'
        : h.status === 'delayed'          ? 'Delay Alert'
        : 'Status Update'
      const deliveryStatus = h.status === 'delivered' ? 'Delivered'
        : h.status === 'cancelled' ? 'Failed'
        : ['scheduled', 'confirmed', 'in_transit'].includes(h.status) ? 'Pending'
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
