const Expense = require('../models/Expense')
const ShipperRequest = require('../models/ShipperRequest')
const VendorQuoteLine = require('../models/VendorQuoteLine')
const FreightBid = require('../models/FreightBid')
const Delivery = require('../models/Delivery')
const PaymentApproval = require('../models/PaymentApproval')
const ProjectBudget = require('../models/ProjectBudget')

const { resolveTotalBudget } = require('./budgetVsActual.util')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const APPROVED_EXPENSE_STATUSES = new Set(['approved', 'paid'])
const PENDING_EXPENSE_STATUSES = new Set(['pending'])
const PENDING_SHIPPER_STATUSES = [
  'submitted',
  'comparison_completed',
  'comparison_processing',
  'resubmit_requested',
]
const APPROVED_SHIPPER_STATUS = 'approved'

const lineAmount = (line) => {
  if (line.amount != null && !Number.isNaN(Number(line.amount))) return Number(line.amount)
  const qty = line.qty ?? line.pieceQty
  if (qty != null && line.unitPrice != null) return Number(qty) * Number(line.unitPrice)
  return 0
}

const requestQuoteAmount = (sr, lineTotalsByRequestId) => {
  if (sr.quoteValue != null && !Number.isNaN(Number(sr.quoteValue))) return Number(sr.quoteValue)
  return lineTotalsByRequestId.get(String(sr._id)) || 0
}

const loadLineTotalsByRequestId = async (requestIds) => {
  const map = new Map()
  if (!requestIds.length) return map
  const lines = await VendorQuoteLine.find({ shipperRequestId: { $in: requestIds } })
    .select('shipperRequestId amount qty pieceQty unitPrice')
    .lean()
  for (const line of lines) {
    const key = String(line.shipperRequestId)
    map.set(key, (map.get(key) || 0) + lineAmount(line))
  }
  return map
}

const sumShipperRequestsByStatus = async (leadIds, statuses, dateFilterOnRequest = null) => {
  if (!leadIds.length) return 0
  const q = { leadId: { $in: leadIds }, status: { $in: statuses } }
  if (dateFilterOnRequest) Object.assign(q, dateFilterOnRequest)
  const requests = await ShipperRequest.find(q).select('_id leadId quoteValue status reviewedAt submittedAt').lean()
  const lineTotals = await loadLineTotalsByRequestId(requests.map((r) => r._id))
  return requests.reduce((s, sr) => s + requestQuoteAmount(sr, lineTotals), 0)
}

const sumFreightBidsForLeads = async (leadIds) => {
  if (!leadIds.length) return 0
  const deliveries = await Delivery.find({ leadId: { $in: leadIds } }).select('_id').lean()
  const deliveryIds = deliveries.map((d) => d._id)
  if (!deliveryIds.length) return 0
  const agg = await FreightBid.aggregate([
    { $match: { deliveryId: { $in: deliveryIds }, status: 'selected' } },
    { $group: { _id: null, total: { $sum: '$quotedAmount' } } },
  ])
  return agg[0]?.total || 0
}

const categorizeManualExpense = (expense, buckets) => {
  const amt = expense.amount || 0
  const cat = String(expense.category || '').toLowerCase()
  if (cat === 'materials') buckets.materialCost += amt
  else if (cat === 'labour') buckets.manpowerCost += amt
  else if (['transport', 'logistics', 'equipment'].includes(cat)) buckets.logisticsCost += amt
  else if (['subcontractor', 'permits', 'site'].includes(cat)) buckets.siteCost += amt
  else if (['office', 'administrative', 'utilities'].includes(cat)) buckets.administrativeCost += amt
  else buckets.miscellaneous += amt
}

/**
 * Combined project expense: manual Expense records + vendor/material from email shipper quotes
 * (ShipperRequest + VendorQuoteLine) + selected freight bids (FreightBid).
 */
exports.aggregateProjectExpenses = async (leadIds, dateFilterOnExpenseDate = {}) => {
  const ids = Array.isArray(leadIds) ? leadIds : [leadIds]
  if (!ids.length) {
    return {
      manualExpenseTotal: 0,
      manualApproved: 0,
      manualPending: 0,
      vendorMaterialFromBids: 0,
      vendorMaterialApproved: 0,
      vendorMaterialPending: 0,
      freightFromBids: 0,
      paymentApprovalPending: 0,
      paymentApprovalApproved: 0,
      totalExpense: 0,
      approvedExpense: 0,
      pendingApproval: 0,
      budgetedExpense: 0,
      budgetVariance: 0,
      categories: {},
    }
  }

  const expenseFilter = { leadId: { $in: ids }, isActive: true, ...dateFilterOnExpenseDate }
  const expenses = await Expense.find(expenseFilter).select('amount category status').lean()

  let manualExpenseTotal = 0
  let manualApproved = 0
  let manualPending = 0
  const categories = {
    materialCost: 0,
    manpowerCost: 0,
    logisticsCost: 0,
    siteCost: 0,
    administrativeCost: 0,
    miscellaneous: 0,
  }

  for (const e of expenses) {
    manualExpenseTotal += e.amount || 0
    if (APPROVED_EXPENSE_STATUSES.has(e.status)) manualApproved += e.amount || 0
    else if (PENDING_EXPENSE_STATUSES.has(e.status) || !e.status) manualPending += e.amount || 0
    else manualApproved += e.amount || 0
    categorizeManualExpense(e, categories)
  }

  const [vendorMaterialApproved, vendorMaterialPending, freightFromBids, budgets, approvalAgg] =
    await Promise.all([
      sumShipperRequestsByStatus(ids, [APPROVED_SHIPPER_STATUS]),
      sumShipperRequestsByStatus(ids, PENDING_SHIPPER_STATUSES),
      sumFreightBidsForLeads(ids),
      ProjectBudget.find({ leadId: { $in: ids } }).select('totalBudget materialBudget logisticBudget').lean(),
      PaymentApproval.aggregate([
        { $match: { leadId: { $in: ids } } },
        {
          $group: {
            _id: '$status',
            total: { $sum: '$amount' },
          },
        },
      ]),
    ])

  const vendorMaterialFromBids = vendorMaterialApproved + vendorMaterialPending
  categories.materialCost += vendorMaterialApproved + vendorMaterialPending
  categories.logisticsCost += freightFromBids

  let paymentApprovalPending = 0
  let paymentApprovalApproved = 0
  for (const row of approvalAgg) {
    if (row._id === 'approved') paymentApprovalApproved += row.total
    else if (['pending', 'under_review', 'disputed'].includes(row._id)) paymentApprovalPending += row.total
  }

  const budgetedExpense = budgets.reduce((s, b) => s + resolveTotalBudget(b), 0)
  const totalExpense = round2(
    manualExpenseTotal + vendorMaterialFromBids + freightFromBids
  )
  const approvedExpense = round2(
    manualApproved + vendorMaterialApproved + freightFromBids + paymentApprovalApproved
  )
  const pendingApproval = round2(
    manualPending + vendorMaterialPending + paymentApprovalPending
  )
  const budgetVariance = round2(totalExpense - budgetedExpense)

  return {
    manualExpenseTotal: round2(manualExpenseTotal),
    manualApproved: round2(manualApproved),
    manualPending: round2(manualPending),
    vendorMaterialFromBids: round2(vendorMaterialFromBids),
    vendorMaterialApproved: round2(vendorMaterialApproved),
    vendorMaterialPending: round2(vendorMaterialPending),
    freightFromBids: round2(freightFromBids),
    paymentApprovalPending: round2(paymentApprovalPending),
    paymentApprovalApproved: round2(paymentApprovalApproved),
    totalExpense,
    approvedExpense,
    pendingApproval,
    budgetedExpense: round2(budgetedExpense),
    budgetVariance,
    categories: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, round2(v)])
    ),
  }
}

exports.aggregateProjectExpensesForLead = async (leadId, dateFilter = {}) =>
  exports.aggregateProjectExpenses([leadId], dateFilter)

/** Email bid costs only (vendor/material shipper quotes + selected freight) — no manual Expense rows. */
exports.aggregateEmailBidExpenses = async (leadIds, dateFilterOnExpenseDate = {}) => {
  const ids = Array.isArray(leadIds) ? leadIds : [leadIds]
  if (!ids.length) {
    return {
      vendorMaterialApproved: 0,
      vendorMaterialPending: 0,
      vendorMaterialFromBids: 0,
      freightFromBids: 0,
      total: 0,
    }
  }
  const [vendorMaterialApproved, vendorMaterialPending, freightFromBids] = await Promise.all([
    sumShipperRequestsByStatus(ids, [APPROVED_SHIPPER_STATUS]),
    sumShipperRequestsByStatus(ids, PENDING_SHIPPER_STATUSES),
    sumFreightBidsForLeads(ids),
  ])
  const vendorMaterialFromBids = vendorMaterialApproved + vendorMaterialPending
  return {
    vendorMaterialApproved: round2(vendorMaterialApproved),
    vendorMaterialPending: round2(vendorMaterialPending),
    vendorMaterialFromBids: round2(vendorMaterialFromBids),
    freightFromBids: round2(freightFromBids),
    total: round2(vendorMaterialFromBids + freightFromBids),
  }
}

const emptyLeadBucket = () => ({
  manualExpenseTotal: 0,
  manualApproved: 0,
  manualPending: 0,
  vendorMaterialApproved: 0,
  vendorMaterialPending: 0,
  freightFromBids: 0,
  paymentApprovalPending: 0,
  paymentApprovalApproved: 0,
  budgetedExpense: 0,
  categories: {
    materialCost: 0,
    manpowerCost: 0,
    logisticsCost: 0,
    siteCost: 0,
    administrativeCost: 0,
    miscellaneous: 0,
  },
})

/** Per-lead expense rollups for project-wise analytics tables. */
exports.aggregateProjectExpensesByLeadMap = async (leadIds, dateFilterOnExpenseDate = {}) => {
  const objectIds = Array.isArray(leadIds) ? leadIds : [leadIds]
  if (!objectIds.length) return new Map()
  const map = new Map()
  for (const id of objectIds) map.set(String(id), emptyLeadBucket())

  const expenseFilter = { leadId: { $in: objectIds }, isActive: true, ...dateFilterOnExpenseDate }
  const [expenses, shipperRequests, deliveries, budgets, approvalRows] = await Promise.all([
    Expense.find(expenseFilter).select('leadId amount category status').lean(),
    ShipperRequest.find({ leadId: { $in: objectIds } })
      .select('_id leadId quoteValue status')
      .lean(),
    Delivery.find({ leadId: { $in: objectIds } }).select('_id leadId').lean(),
    ProjectBudget.find({ leadId: { $in: objectIds } }).select('leadId totalBudget').lean(),
    PaymentApproval.aggregate([
      { $match: { leadId: { $in: objectIds } } },
      { $group: { _id: { leadId: '$leadId', status: '$status' }, total: { $sum: '$amount' } } },
    ]),
  ])

  const deliveryIds = deliveries.map((d) => d._id)
  const freightRows = deliveryIds.length
    ? await FreightBid.find({ deliveryId: { $in: deliveryIds }, status: 'selected' })
        .select('deliveryId quotedAmount')
        .lean()
    : []

  const lineTotals = await loadLineTotalsByRequestId(shipperRequests.map((r) => r._id))
  const deliveryToLead = new Map(deliveries.map((d) => [String(d._id), String(d.leadId)]))

  for (const e of expenses) {
    const key = String(e.leadId)
    const b = map.get(key)
    if (!b) continue
    const amt = e.amount || 0
    b.manualExpenseTotal += amt
    if (APPROVED_EXPENSE_STATUSES.has(e.status)) b.manualApproved += amt
    else if (PENDING_EXPENSE_STATUSES.has(e.status)) b.manualPending += amt
    else b.manualApproved += amt
    categorizeManualExpense(e, b.categories)
  }

  for (const sr of shipperRequests) {
    const key = String(sr.leadId)
    const b = map.get(key)
    if (!b) continue
    const amt = requestQuoteAmount(sr, lineTotals)
    if (sr.status === APPROVED_SHIPPER_STATUS) {
      b.vendorMaterialApproved += amt
      b.categories.materialCost += amt
    } else if (PENDING_SHIPPER_STATUSES.includes(sr.status)) {
      b.vendorMaterialPending += amt
      b.categories.materialCost += amt
    }
  }

  for (const fb of freightRows) {
    const leadKey = deliveryToLead.get(String(fb.deliveryId))
    const b = map.get(leadKey)
    if (!b) continue
    const amt = fb.quotedAmount || 0
    b.freightFromBids += amt
    b.categories.logisticsCost += amt
  }

  for (const bud of budgets) {
    const b = map.get(String(bud.leadId))
    if (b) b.budgetedExpense += bud.totalBudget || 0
  }

  for (const row of approvalRows) {
    const key = String(row._id.leadId)
    const b = map.get(key)
    if (!b) continue
    if (row._id.status === 'approved') b.paymentApprovalApproved += row.total
    else if (['pending', 'under_review', 'disputed'].includes(row._id.status)) {
      b.paymentApprovalPending += row.total
    }
  }

  const result = new Map()
  for (const [key, b] of map) {
    const vendorMaterialFromBids = b.vendorMaterialApproved + b.vendorMaterialPending
    const totalExpense = b.manualExpenseTotal + vendorMaterialFromBids + b.freightFromBids
    const approvedExpense =
      b.manualApproved + b.vendorMaterialApproved + b.freightFromBids + b.paymentApprovalApproved
    const pendingApproval = b.manualPending + b.vendorMaterialPending + b.paymentApprovalPending
    result.set(key, {
      manualExpenseTotal: round2(b.manualExpenseTotal),
      manualApproved: round2(b.manualApproved),
      manualPending: round2(b.manualPending),
      vendorMaterialFromBids: round2(vendorMaterialFromBids),
      vendorMaterialApproved: round2(b.vendorMaterialApproved),
      vendorMaterialPending: round2(b.vendorMaterialPending),
      freightFromBids: round2(b.freightFromBids),
      paymentApprovalPending: round2(b.paymentApprovalPending),
      paymentApprovalApproved: round2(b.paymentApprovalApproved),
      totalExpense: round2(totalExpense),
      approvedExpense: round2(approvedExpense),
      pendingApproval: round2(pendingApproval),
      budgetedExpense: round2(b.budgetedExpense),
      budgetVariance: round2(totalExpense - b.budgetedExpense),
      variancePct:
        b.budgetedExpense > 0
          ? round2(((totalExpense - b.budgetedExpense) / b.budgetedExpense) * 100)
          : 0,
      categories: Object.fromEntries(
        Object.entries(b.categories).map(([k, v]) => [k, round2(v)])
      ),
    })
  }
  return result
}

module.exports.round2 = round2
