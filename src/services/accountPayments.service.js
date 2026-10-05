const WIPProfit = require('../models/WIPProfit')
const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const Expense = require('../models/Expense')
const { buildPeriodDateFilter } = require('../utils/dateRange')
const { WIP_STATUSES } = require('../models/WIPProfit')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const STATUS_LABELS = {
  in_progress: 'In progress',
  started: 'Started',
  completed: 'Completed',
  on_hold: 'On hold',
}

const normalizeStatusFilter = (status) => {
  if (!status || String(status).toLowerCase() === 'all') return null
  const key = String(status).toLowerCase().replace(/\s+/g, '_')
  const map = {
    in_progress: 'in_progress',
    inprogress: 'in_progress',
    started: 'started',
    completed: 'completed',
    on_hold: 'on_hold',
  }
  return map[key] || (WIP_STATUSES.includes(key) ? key : null)
}

const recomputeWipFields = (doc) => {
  const orderValue = Number(doc.orderValue) || 0
  const currentCost = Number(doc.currentCost) || 0
  const depositPaid = Number(doc.depositPaid) || 0
  const progressPaid = Number(doc.progressPaid) || 0
  const finalPaid = Number(doc.finalPaid) || 0
  const totalReceived = depositPaid + progressPaid + finalPaid
  doc.outstanding = round2(Math.max(0, orderValue - totalReceived))
  doc.wipProfit = round2(totalReceived - currentCost)
  doc.marginPct = orderValue > 0 ? round2((doc.wipProfit / orderValue) * 100) : 0
  return doc
}

const customerNameFromLead = (lead) => {
  const c = lead?.customerId
  if (!c) return ''
  if (typeof c === 'object') {
    return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.firstName || ''
  }
  return ''
}

exports.mapOrderRow = (wip) => {
  const lead = wip.leadId
  const totalReceived = (wip.depositPaid || 0) + (wip.progressPaid || 0) + (wip.finalPaid || 0)
  return {
    wipId: wip._id,
    leadId: lead?._id || wip.leadId,
    orderDetails: {
      customerName: customerNameFromLead(lead),
      orderId: lead?.jobId || '',
      quoteOrderId: lead?.jobId || '',
      location: lead?.location || '',
    },
    orderValue: round2(wip.orderValue),
    currentCost: round2(wip.currentCost),
    paymentBreakdown: {
      deposit: round2(wip.depositPaid),
      progress: round2(wip.progressPaid),
      final: round2(wip.finalPaid),
    },
    outstanding: round2(wip.outstanding),
    profit: round2(wip.wipProfit),
    marginPct: wip.marginPct,
    status: STATUS_LABELS[wip.status] || wip.status,
    statusCode: wip.status,
    totalReceived: round2(totalReceived),
  }
}

exports.mapOrderDetail = (wip) => {
  const row = exports.mapOrderRow(wip)
  const lead = wip.leadId
  const totalReceived = row.totalReceived
  return {
    ...row,
    profile: {
      quoteId: lead?.jobId || '',
      quoteOrderId: lead?.jobId || '',
      customerName: row.orderDetails.customerName,
      orderValue: row.orderValue,
      projectName: lead?.projectName || '',
      location: lead?.location || '',
    },
    financials: {
      deposit: row.paymentBreakdown.deposit,
      progress: row.paymentBreakdown.progress,
      final: row.paymentBreakdown.final,
      profit: row.profit,
      outstanding: row.outstanding,
      totalPayable: row.outstanding,
      totalReceived,
      marginPct: row.marginPct,
    },
    paymentStatus: row.status,
    paymentStatusCode: row.statusCode,
    notes: wip.notes || '',
    payments: wip.payments || [],
    updatedAt: wip.updatedAt,
    createdAt: wip.createdAt,
  }
}

exports.computePaymentStats = async (query = {}) => {
  const dateFilter = buildPeriodDateFilter(query, 'createdAt')
  const match = Object.keys(dateFilter).length ? [{ $match: dateFilter }] : []

  const agg = await WIPProfit.aggregate([
    ...match,
    {
      $group: {
        _id: null,
        totalOrderValue: { $sum: '$orderValue' },
        totalReceived: {
          $sum: { $add: ['$depositPaid', '$progressPaid', '$finalPaid'] },
        },
        outstanding: { $sum: '$outstanding' },
        totalWipProfit: { $sum: '$wipProfit' },
      },
    },
  ])

  const s = agg[0] || {}
  return {
    totalOrderValue: round2(s.totalOrderValue),
    totalReceived: round2(s.totalReceived),
    outstanding: round2(s.outstanding),
    totalWipProfit: round2(s.totalWipProfit),
  }
}

exports.listOrders = async (query = {}) => {
  const { page = 1, limit = 20, search, status } = query
  const dateFilter = buildPeriodDateFilter(query, 'createdAt')
  const filter = { ...dateFilter }

  const statusCode = normalizeStatusFilter(status)
  if (statusCode) filter.status = statusCode

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const matchingLeads = await Lead.find({
      $or: [
        { projectName: regex },
        { jobId: regex },
        { location: regex },
      ],
    }).select('_id').lean()
    const customers = await Customer.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    }).select('_id').lean()
    const customerIds = customers.map((c) => c._id)
    const leadsByCustomer = customerIds.length
      ? await Lead.find({ customerId: { $in: customerIds } }).select('_id').lean()
      : []
    const leadIds = [
      ...matchingLeads.map((l) => l._id),
      ...leadsByCustomer.map((l) => l._id),
    ]
    filter.$or = [{ leadId: { $in: leadIds } }]
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const [wips, total] = await Promise.all([
    WIPProfit.find(filter)
      .populate({
        path: 'leadId',
        select: 'projectName jobId location customerId lifecycleStatus quoteValue',
        populate: { path: 'customerId', select: 'firstName lastName email' },
      })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    WIPProfit.countDocuments(filter),
  ])

  return {
    stats: await exports.computePaymentStats(query),
    orders: wips.map(exports.mapOrderRow),
    total,
    page: parsedPage,
    limit: parsedLimit,
  }
}

exports.resolveWip = async (idOrLeadId) => {
  let wip = await WIPProfit.findById(idOrLeadId)
    .populate({
      path: 'leadId',
      select: 'projectName jobId location customerId lifecycleStatus quoteValue',
      populate: { path: 'customerId', select: 'firstName lastName email' },
    })
    .lean()
  if (wip) return wip

  wip = await WIPProfit.findOne({ leadId: idOrLeadId })
    .populate({
      path: 'leadId',
      select: 'projectName jobId location customerId lifecycleStatus quoteValue',
      populate: { path: 'customerId', select: 'firstName lastName email' },
    })
    .lean()
  if (wip) return wip

  const lead = await Lead.findOne({
    $or: [{ _id: idOrLeadId }, { jobId: idOrLeadId }],
  })
    .populate('customerId', 'firstName lastName email')
    .lean()
  if (!lead) return null

  return WIPProfit.findOne({ leadId: lead._id })
    .populate({
      path: 'leadId',
      select: 'projectName jobId location customerId lifecycleStatus quoteValue',
      populate: { path: 'customerId', select: 'firstName lastName email' },
    })
    .lean()
}

/** Leads eligible for the Add Order Payment quote/order dropdown */
const ORDER_OPTION_LIFECYCLE = [
  'deal_closed',
  'payment_done',
  'converted_to_po',
  'sent_to_admin',
  'released_to_plant',
  'drawings_received',
  'bom_received',
  'bom_review',
  'material_check',
  'production_planning',
  'fabrication_started',
  'quality_inspection',
  'packing_bundling',
  'shipper_prepared',
  'ready_for_delivery',
  'dispatched',
  'delivered',
]

exports.listOrderOptions = async (query = {}) => {
  const { search, limit = 50, excludeWithWip } = query
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200)

  const filter = {
    lifecycleStatus: { $in: ORDER_OPTION_LIFECYCLE },
    jobId: { $exists: true, $nin: [null, ''] },
  }

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const customers = await Customer.find({
      $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
    })
      .select('_id')
      .lean()
    const customerIds = customers.map((c) => c._id)
    filter.$or = [
      { projectName: regex },
      { jobId: regex },
      { location: regex },
      ...(customerIds.length ? [{ customerId: { $in: customerIds } }] : []),
    ]
  }

  let leadIdsWithWip = null
  if (excludeWithWip === true || excludeWithWip === 'true' || excludeWithWip === '1') {
    const wips = await WIPProfit.find().select('leadId').lean()
    leadIdsWithWip = new Set(wips.map((w) => String(w.leadId)))
  }

  const leads = await Lead.find(filter)
    .populate('customerId', 'firstName lastName email')
    .select('projectName jobId location quoteValue lifecycleStatus customerId')
    .sort({ updatedAt: -1 })
    .limit(parsedLimit * 3)
    .lean()

  const leadIds = leads.map((l) => l._id)
  const wipByLead = Object.fromEntries(
    (
      await WIPProfit.find({ leadId: { $in: leadIds } })
        .select('leadId')
        .lean()
    ).map((w) => [String(w.leadId), w._id])
  )

  let options = leads.map((lead) => {
    const customerName = customerNameFromLead(lead)
    const quoteOrderId = lead.jobId || ''
    const projectName = lead.projectName || customerName || 'Project'
    const label = [quoteOrderId, customerName, projectName].filter(Boolean).join(' — ')
    const wipId = wipByLead[String(lead._id)] || null
    return {
      leadId: lead._id,
      quoteOrderId,
      label,
      projectName: lead.projectName || '',
      customerName,
      location: lead.location || '',
      quoteValue: round2(lead.quoteValue),
      lifecycleStatus: lead.lifecycleStatus,
      hasWipRecord: Boolean(wipId),
      wipId,
    }
  })

  if (leadIdsWithWip) {
    options = options.filter((o) => !leadIdsWithWip.has(String(o.leadId)))
  }

  options = options.slice(0, parsedLimit)

  return { options, total: options.length }
}

exports.resolveLeadForOrder = async (quoteOrderId, leadId) => {
  if (leadId) {
    const lead = await Lead.findById(leadId).lean()
    return lead
  }
  if (!quoteOrderId) return null
  return Lead.findOne({
    $or: [{ jobId: quoteOrderId }, { _id: quoteOrderId }],
  }).lean()
}

exports.upsertOrder = async (payload, userId) => {
  const {
    leadId,
    quoteOrderId,
    orderValue,
    currentCost,
    depositPaid = 0,
    progressPaid = 0,
    finalPaid = 0,
    status = 'in_progress',
    notes,
  } = payload

  const lead = await exports.resolveLeadForOrder(quoteOrderId, leadId)
  if (!lead) return { error: 'Project / quote not found' }

  let cost = currentCost
  if (cost == null || cost === '') {
    const expAgg = await Expense.aggregate([
      { $match: { leadId: lead._id, isActive: true } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    cost = expAgg[0]?.total || 0
  }

  const ov = orderValue != null && orderValue !== '' ? Number(orderValue) : (lead.quoteValue || 0)

  let wip = await WIPProfit.findOne({ leadId: lead._id })
  const data = {
    leadId: lead._id,
    orderValue: ov,
    currentCost: Number(cost) || 0,
    depositPaid: Number(depositPaid) || 0,
    progressPaid: Number(progressPaid) || 0,
    finalPaid: Number(finalPaid) || 0,
    status: WIP_STATUSES.includes(status) ? status : 'in_progress',
    notes: notes || '',
  }
  recomputeWipFields(data)

  if (wip) {
    Object.assign(wip, {
      orderValue: data.orderValue,
      currentCost: data.currentCost,
      depositPaid: data.depositPaid,
      progressPaid: data.progressPaid,
      finalPaid: data.finalPaid,
      status: data.status,
      notes: data.notes,
      outstanding: data.outstanding,
      wipProfit: data.wipProfit,
      marginPct: data.marginPct,
    })
    await wip.save()
    return { wip: await exports.resolveWip(wip._id) }
  }

  wip = await WIPProfit.create({ ...data, createdBy: userId })
  return { wip: await exports.resolveWip(wip._id) }
}

exports.STATUS_LABELS = STATUS_LABELS
exports.normalizeStatusFilter = normalizeStatusFilter
exports.recomputeWipFields = recomputeWipFields
