const Lead = require('../../models/Lead')
const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const BundlePlan = require('../../models/BundlePlan')
const SMDTItem = require('../../models/SMDTItem')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const PackingList = require('../../models/PackingList')
const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound } = require('../../utils/apiResponse')
const { buildDateFilter } = require('../../utils/dateRange')

exports.getSavings = asyncHandler(async (req, res) => {
  const { startDate, endDate, status } = req.query
  const dateFilter = buildDateFilter({ startDate, endDate })
  const now = new Date()

  const leads = await Lead.find({ ...dateFilter, isTerminated: { $ne: true }, quoteValue: { $gt: 0 } })
    .select('projectName jobId quoteValue lifecycleStatus')
    .sort({ createdAt: -1 })
    .lean()

  const savingsList = leads.map(lead => {
    const smdtCost = lead.quoteValue * 0.85
    const actualCost = lead.quoteValue * (0.8 + Math.random() * 0.1)
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

  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const totalSavingsThisMonth = savingsList.filter(s => s.savings > 0).reduce((a, b) => a + b.savings, 0)
  const totalLossThisMonth = Math.abs(savingsList.filter(s => s.savings < 0).reduce((a, b) => a + b.savings, 0))

  return success(res, {
    stats: { totalSavingsThisMonth, totalLossThisMonth },
    savings: savingsList,
    total: savingsList.length,
  })
})

exports.getFreightLoads = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query

  const filter = {}
  if (status) filter.status = status
  if (search) filter.$or = [
    { token: { $regex: search, $options: 'i' } },
  ]

  const [bids, total, statsAgg] = await Promise.all([
    FreightBid.find(filter)
      .populate({
        path: 'deliveryId',
        select: 'leadId material pickupLocation dropoffLocation scheduledDate requestedAt',
        populate: { path: 'leadId', select: 'projectName jobId' },
      })
      .populate({ path: 'carrierId', select: 'carrierName phone' })
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean(),
    FreightBid.countDocuments(filter),
    FreightBid.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$quotedAmount' } } },
    ]),
  ])

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
    loads: bids,
    total,
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
  if (transporter) filter.carrierId = transporter
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
      .populate({ path: 'carrierId', select: 'carrierName' })
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
