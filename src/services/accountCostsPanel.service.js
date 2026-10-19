const Expense = require('../models/Expense')
const User = require('../models/User')
const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const Vendor = require('../models/Vendor')
const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const FreightCarrier = require('../models/FreightCarrier')
const ShipperRequest = require('../models/ShipperRequest')
const PaymentApproval = require('../models/PaymentApproval')
const ProjectBudget = require('../models/ProjectBudget')
const { buildDateFilter } = require('../utils/dateRange')
const { resolveTotalBudget, budgetVarianceStatus } = require('../utils/budgetVsActual.util')
const { aggregateProjectExpensesByLeadMap } = require('../utils/projectExpenseAggregate.util')
const {
  round2,
  pctChange,
  panelBaseFilter,
  monthWindows,
  sumExpenses,
} = require('../utils/expensePanelQuery.util')

const MISC_CATEGORIES = new Set([
  'office',
  'maintenance',
  'other',
  'utilities',
  'equipment',
  'permits',
  'Miscellaneous',
  'Marketing',
])

const paginate = (query) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10))
  return { page, limit, skip: (page - 1) * limit }
}

const trendForPanel = async (costPanelType) => {
  const { thisStart, lastStart, lastEnd } = monthWindows()
  const [thisRows, lastRows] = await Promise.all([
    Expense.find({ isActive: true, costPanelType, date: { $gte: thisStart } }).select('amount').lean(),
    Expense.find({
      isActive: true,
      costPanelType,
      date: { $gte: lastStart, $lte: lastEnd },
    })
      .select('amount')
      .lean(),
  ])
  return pctChange(sumExpenses(thisRows), sumExpenses(lastRows))
}

const mapSalaryRow = (e) => ({
  id: e._id,
  expenseId: e.expenseId,
  employeeName: e.metadata?.employeeName || e.description || '',
  employeeId: e.metadata?.employeeId || e.buildingLabel || '',
  designation: e.metadata?.designation || e.subcategory || '',
  netSalary: round2(e.amount),
  status: e.status === 'paid' ? 'Paid' : 'Unpaid',
  adminApproval: e.metadata?.adminApproval || (e.status === 'approved' || e.status === 'paid' ? 'Approved' : 'Pending'),
  date: e.date,
  paymentStatus: e.status,
  payslipGeneratedAt: e.metadata?.payslipGeneratedAt || null,
  hasPayslip: Boolean(e.metadata?.payslipGeneratedAt),
  payslipFileName: e.metadata?.payslipFileName || '',
})

const mapManpowerRow = (e) => {
  const m = e.metadata || {}
  const hours = Number(m.workingHours) || 0
  const ot = Number(m.otHours) || 0
  const rate = Number(m.ratePerHour) || 0
  const computed = hours * rate + ot * rate * 1.5
  return {
    id: e._id,
    expenseId: e.expenseId,
    date: e.date,
    employee: {
      userId: m.employeeUserId || null,
      name: m.employeeName || e.description || '',
      designation: m.designation || e.subcategory || '',
    },
    project: e.leadId?.projectName || '',
    leadId: e.leadId?._id || e.leadId,
    hours,
    otHours: ot,
    ratePerHour: rate,
    totalCost: round2(e.amount || computed),
    status: e.status === 'paid' ? 'Paid' : 'Unpaid',
    paymentStatus: e.status,
  }
}

const mapMiscRow = (e) => ({
  id: e._id,
  expenseId: e.expenseId,
  date: e.date,
  expenseName: e.metadata?.expenseName || e.description || '',
  category: e.category,
  project: e.leadId?.projectName || '',
  leadId: e.leadId?._id || e.leadId,
  vendorPayee: e.metadata?.vendorPayee || e.metadata?.vendorName || '',
  amount: round2(e.amount),
  approvalStatus: e.status === 'approved' || e.status === 'paid' ? 'Approved' : 'Pending',
  receiptFile: e.receiptFile || '',
})

exports.getFilters = async () => {
  const [projects, vendors, employees, designations] = await Promise.all([
    Lead.find({ isTerminated: { $ne: true }, isArchived: { $ne: true } })
      .select('projectName jobId')
      .sort({ projectName: 1 })
      .limit(500)
      .lean(),
    Vendor.find({ status: { $ne: 'inactive' } }).select('vendorName vendorCode').limit(300).lean(),
    User.find({ isActive: true, role: { $nin: ['customer'] } })
      .select('name email role')
      .sort({ name: 1 })
      .limit(500)
      .lean(),
    Expense.distinct('subcategory', { subcategory: { $nin: ['', null] } }),
  ])
  return {
    projects: projects.map((p) => ({ leadId: p._id, projectName: p.projectName, jobId: p.jobId })),
    vendors: vendors.map((v) => ({ vendorId: v._id, label: v.vendorName, code: v.vendorCode || '' })),
    employees: employees.map((u) => ({
      userId: u._id,
      name: u.name,
      email: u.email,
      employeeId: `EMP-${String(u._id).slice(-4).toUpperCase()}`,
      designation: u.role,
    })),
    designations,
    paymentStatuses: ['pending', 'approved', 'paid', 'rejected'],
  }
}

exports.getSalarySummary = async () => {
  const rows = await Expense.find({ isActive: true, costPanelType: 'salary' }).select('amount status').lean()
  const total = sumExpenses(rows)
  const paid = sumExpenses(rows.filter((r) => r.status === 'paid'))
  const pending = total - paid
  const trend = await trendForPanel('salary')
  return {
    totalSalaryCost: round2(total),
    netSalaryPaid: round2(paid),
    pendingSalary: round2(pending),
    trends: {
      totalSalaryCost: trend,
      netSalaryPaid: trend,
      pendingSalary: trend,
    },
  }
}

exports.listSalaryRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = panelBaseFilter('salary', query)
  const [rows, total] = await Promise.all([
    Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(),
    Expense.countDocuments(filter),
  ])
  return { rows: rows.map(mapSalaryRow), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } }
}

exports.createSalaryEntry = async (body, userId, generateExpenseId) => {
  const amount = Number(body.netSalary ?? body.amount)
  const expense = await Expense.create({
    expenseId: await generateExpenseId(),
    costPanelType: 'salary',
    category: 'labour',
    subcategory: body.designation || 'salary',
    date: body.date,
    amount,
    description: body.employeeName || '',
    buildingLabel: body.employeeId || '',
    leadId: body.leadId || null,
    status: body.paymentStatus || body.status || 'pending',
    metadata: {
      employeeUserId: body.employeeUserId,
      employeeName: body.employeeName,
      employeeId: body.employeeId,
      designation: body.designation,
      adminApproval: body.adminApproval || 'Pending',
    },
    createdBy: userId,
  })
  return mapSalaryRow(expense.toObject())
}

exports.markSalaryPaid = async (id) => {
  const expense = await Expense.findOne({ _id: id, costPanelType: 'salary', isActive: true })
  if (!expense) return null
  expense.status = 'paid'
  if (expense.metadata) expense.metadata.adminApproval = 'Approved'
  await expense.save()
  return mapSalaryRow(expense.toObject())
}

exports.getSalaryRecordById = async (id) => {
  const expense = await Expense.findOne({ _id: id, costPanelType: 'salary', isActive: true }).lean()
  return expense ? mapSalaryRow(expense) : null
}

exports.getManpowerSummary = async () => {
  const rows = await Expense.find({ isActive: true, costPanelType: 'manpower' }).select('amount metadata').lean()
  const total = sumExpenses(rows)
  const workforce = new Set(rows.map((r) => r.metadata?.employeeUserId || r.metadata?.employeeName)).size
  const totalHours = rows.reduce((s, r) => s + (Number(r.metadata?.workingHours) || 0) + (Number(r.metadata?.otHours) || 0), 0)
  const avgPerHour = totalHours > 0 ? total / totalHours : 0
  const trend = await trendForPanel('manpower')
  return {
    totalManpowerCost: round2(total),
    activeWorkforce: workforce,
    totalWorkingHours: totalHours,
    averageCostPerHour: round2(avgPerHour),
    trends: {
      totalManpowerCost: trend,
      activeWorkforce: 0,
      totalWorkingHours: trend,
      averageCostPerHour: trend,
    },
  }
}

exports.listManpowerRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = panelBaseFilter('manpower', query)
  const [rows, total] = await Promise.all([
    Expense.find(filter).populate('leadId', 'projectName jobId').sort({ date: -1 }).skip(skip).limit(limit).lean(),
    Expense.countDocuments(filter),
  ])
  return {
    rows: rows.map(mapManpowerRow),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

exports.getManpowerRecordById = async (id) => {
  const expense = await Expense.findOne({ _id: id, costPanelType: 'manpower', isActive: true })
    .populate('leadId', 'projectName jobId')
    .lean()
  return expense ? mapManpowerRow(expense) : null
}

exports.createManpowerEntry = async (body, userId, generateExpenseId) => {
  const hours = Number(body.workingHours) || 0
  const ot = Number(body.otHours) || 0
  const rate = Number(body.ratePerHour) || 0
  const amount = Number(body.totalCost) || round2(hours * rate + ot * rate * 1.5)
  const expense = await Expense.create({
    expenseId: await generateExpenseId(),
    costPanelType: 'manpower',
    category: 'labour',
    subcategory: body.designation || 'manpower',
    date: body.date,
    amount,
    description: body.employeeName || '',
    leadId: body.leadId || null,
    status: body.paymentStatus || 'pending',
    metadata: {
      employeeUserId: body.employeeUserId,
      employeeName: body.employeeName,
      employeeId: body.employeeId,
      designation: body.designation,
      workingHours: hours,
      otHours: ot,
      ratePerHour: rate,
    },
    createdBy: userId,
  })
  return mapManpowerRow({ ...expense.toObject(), leadId: body.leadId ? { _id: body.leadId, projectName: '' } : null })
}

exports.getMiscellaneousSummary = async (query) => {
  const dateFilter = buildDateFilter(query, 'date')
  const filter = {
    isActive: true,
    ...dateFilter,
    $or: [{ costPanelType: 'miscellaneous' }, { costPanelType: null, category: { $in: [...MISC_CATEGORIES] } }],
  }
  const rows = await Expense.find(filter).select('amount status').lean()
  const total = sumExpenses(rows)
  const approved = sumExpenses(rows.filter((r) => ['approved', 'paid'].includes(r.status)))
  const pending = sumExpenses(rows.filter((r) => r.status === 'pending'))
  const unplanned = sumExpenses(rows.filter((r) => !r.status || r.status === 'pending'))
  return {
    totalMiscellaneousCost: round2(total),
    approvedExpenses: round2(approved),
    pendingApproval: round2(pending),
    unplannedExpenses: round2(unplanned),
    trends: {
      totalMiscellaneousCost: pctChange(total, total * 0.95),
      approvedExpenses: pctChange(approved, approved * 0.9),
      pendingApproval: pctChange(pending, pending * 1.1),
      unplannedExpenses: pctChange(unplanned, unplanned),
    },
  }
}

exports.getMiscellaneousOverviewChart = async (query) => {
  const months = Math.min(12, Math.max(1, Number(query.months) || 6))
  const now = new Date()
  const points = []
  for (let m = months - 1; m >= 0; m--) {
    const start = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59, 999)
    const label = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const [planned, actual] = await Promise.all([
      ProjectBudget.aggregate([
        { $match: { updatedAt: { $lte: end } } },
        { $group: { _id: null, total: { $sum: '$otherCost' } } },
      ]),
      Expense.aggregate([
        {
          $match: {
            isActive: true,
            date: { $gte: start, $lte: end },
            $or: [{ costPanelType: 'miscellaneous' }, { category: { $in: [...MISC_CATEGORIES] } }],
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ])
    points.push({
      label,
      plannedExpense: round2(planned[0]?.total || 0),
      actualExpense: round2(actual[0]?.total || 0),
      unplannedExpense: round2(Math.max(0, (actual[0]?.total || 0) - (planned[0]?.total || 0))),
    })
  }
  return points
}

exports.getMiscellaneousByCategory = async (query) => {
  const dateFilter = buildDateFilter(query, 'date')
  const agg = await Expense.aggregate([
    {
      $match: {
        isActive: true,
        ...dateFilter,
        $or: [{ costPanelType: 'miscellaneous' }, { category: { $in: [...MISC_CATEGORIES] } }],
      },
    },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ])
  const grand = agg.reduce((s, r) => s + r.total, 0)
  return agg.map((r) => ({
    category: r._id,
    amount: round2(r.total),
    pct: grand > 0 ? round2((r.total / grand) * 100) : 0,
    count: r.count,
  }))
}

exports.listMiscellaneousByProject = async (query) => {
  const { page, limit, skip } = paginate(query)
  const dateFilter = buildDateFilter(query, 'date')
  const match = {
    isActive: true,
    leadId: { $ne: null },
    ...dateFilter,
    $or: [{ costPanelType: 'miscellaneous' }, { category: { $in: [...MISC_CATEGORIES] } }],
  }
  const agg = await Expense.aggregate([
    { $match: match },
    { $group: { _id: '$leadId', expenseCount: { $sum: 1 }, amount: { $sum: '$amount' } } },
    { $sort: { amount: -1 } },
    { $skip: skip },
    { $limit: limit },
  ])
  const totalGroups = await Expense.aggregate([{ $match: match }, { $group: { _id: '$leadId' } }, { $count: 'n' }])
  const total = totalGroups[0]?.n || 0
  const leadIds = agg.map((a) => a._id)
  const [leads, budgets, customers] = await Promise.all([
    Lead.find({ _id: { $in: leadIds } }).select('projectName customerId').lean(),
    ProjectBudget.find({ leadId: { $in: leadIds } }).select('leadId otherCost totalBudget').lean(),
    Customer.find().select('firstName lastName').lean(),
  ])
  const leadMap = new Map(leads.map((l) => [String(l._id), l]))
  const budgetMap = new Map(budgets.map((b) => [String(b.leadId), resolveTotalBudget(b)]))
  const custMap = new Map(customers.map((c) => [String(c._id), c]))

  const rows = agg.map((a) => {
    const lead = leadMap.get(String(a._id))
    const budget = budgetMap.get(String(a._id)) || 0
    const variance = a.amount - budget
    const cust = lead?.customerId ? custMap.get(String(lead.customerId)) : null
    return {
      leadId: a._id,
      projectName: lead?.projectName || '',
      customerName: cust ? [cust.firstName, cust.lastName].filter(Boolean).join(' ') : '',
      expenseCount: a.expenseCount,
      amount: round2(a.amount),
      budget: round2(budget),
      variance: round2(variance),
      status: budgetVarianceStatus(a.amount, budget),
    }
  })
  return { rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } }
}

exports.listMiscellaneousRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const dateFilter = buildDateFilter(query, 'date')
  const filter = {
    isActive: true,
    ...dateFilter,
    $or: [{ costPanelType: 'miscellaneous' }, { category: { $in: [...MISC_CATEGORIES] } }],
  }
  if (query.search?.trim()) filter.description = { $regex: query.search.trim(), $options: 'i' }
  if (query.leadId || query.projectId) filter.leadId = query.leadId || query.projectId
  const [rows, total] = await Promise.all([
    Expense.find(filter).populate('leadId', 'projectName').sort({ date: -1 }).skip(skip).limit(limit).lean(),
    Expense.countDocuments(filter),
  ])
  return {
    rows: rows.map(mapMiscRow),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

exports.createMiscellaneousEntry = async (body, userId, generateExpenseId) => {
  const expense = await Expense.create({
    expenseId: await generateExpenseId(),
    costPanelType: 'miscellaneous',
    category: body.expenseCategory || body.category || 'other',
    date: body.date || body.expenseDate,
    amount: Number(body.amount),
    description: body.expenseName || body.description || '',
    leadId: body.leadId || null,
    status: body.paymentStatus === 'Paid' ? 'paid' : body.paymentStatus || 'pending',
    receiptFile: body.receiptFile || body.attachments || '',
    metadata: {
      expenseName: body.expenseName,
      vendorPayee: body.vendorPayee,
      vendorId: body.vendorId,
    },
    createdBy: userId,
  })
  return mapMiscRow(expense.toObject())
}

exports.getFreightSummary = async (query) => {
  const dateFilter = buildDateFilter(query, 'selectedAt')
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const [yearAgg, monthAgg, carrierCount, pendingInvoices] = await Promise.all([
    FreightBid.aggregate([{ $match: { status: 'selected', selectedAt: { $gte: yearStart } } }, { $group: { _id: null, t: { $sum: '$quotedAmount' }, c: { $sum: 1 } } }]),
    FreightBid.aggregate([{ $match: { status: 'selected', selectedAt: { $gte: monthStart } } }, { $group: { _id: null, t: { $sum: '$quotedAmount' }, c: { $sum: 1 } } }]),
    FreightCarrier.countDocuments({ status: 'active' }),
    FreightBid.countDocuments({ status: { $in: ['sent', 'submitted'] } }),
  ])
  const y = yearAgg[0] || {}
  const m = monthAgg[0] || {}
  return {
    yearlyTotal: round2(y.t || 0),
    contractedCarriers: carrierCount,
    avgCostThisMonth: m.c > 0 ? round2((m.t || 0) / m.c) : 0,
    pendingInvoices,
    totalFreightCost: round2(y.t || 0),
    activeCarriers: carrierCount,
    avgCostPerDelivery: y.c > 0 ? round2((y.t || 0) / y.c) : 0,
  }
}

exports.getFreightTrend = async (query) => {
  const months = Math.min(12, Number(query.months) || 6)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const agg = await FreightBid.aggregate([
    { $match: { status: 'selected', selectedAt: { $gte: start } } },
    {
      $group: {
        _id: { year: { $year: '$selectedAt' }, month: { $month: '$selectedAt' } },
        freightCost: { $sum: '$quotedAmount' },
        deliveries: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ])
  return agg.map((r) => ({
    label: `${r._id.month}/${r._id.year}`,
    freightCost: round2(r.freightCost),
    deliveries: r.deliveries,
  }))
}

exports.getFreightCarrierDistribution = async () => {
  const rows = await FreightBid.aggregate([
    { $match: { status: 'selected' } },
    { $group: { _id: '$carrierId', total: { $sum: '$quotedAmount' } } },
    { $sort: { total: -1 } },
    { $lookup: { from: 'freightcarriers', localField: '_id', foreignField: '_id', as: 'carrier' } },
    { $unwind: { path: '$carrier', preserveNullAndEmptyArrays: true } },
  ])
  const grand = rows.reduce((s, r) => s + r.total, 0)
  return rows.map((r) => ({
    carrierId: r._id,
    carrierName: r.carrier?.carrierName || 'Unknown',
    total: round2(r.total),
    pct: grand > 0 ? round2((r.total / grand) * 100) : 0,
  }))
}

exports.listFreightRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = { status: 'selected' }
  if (query.leadId || query.projectId) {
    const deliveries = await Delivery.find({ leadId: query.leadId || query.projectId }).distinct('_id')
    filter.deliveryId = { $in: deliveries }
  }
  const [bids, total] = await Promise.all([
    FreightBid.find(filter)
      .populate('carrierId', 'carrierName')
      .populate({ path: 'deliveryId', select: 'deliveryNumber leadId', populate: { path: 'leadId', select: 'projectName' } })
      .sort({ selectedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FreightBid.countDocuments(filter),
  ])
  const approvals = await PaymentApproval.find({
    linkedType: 'freight_bid',
    linkedId: { $in: bids.map((b) => b._id) },
  })
    .select('linkedId status')
    .lean()
  const approvalMap = new Map(approvals.map((a) => [String(a.linkedId), a.status]))

  const rows = bids.map((b) => {
    const st = approvalMap.get(String(b._id))
    return {
      freightId: `FR-${String(b._id).slice(-5).toUpperCase()}`,
      bidId: b._id,
      projectName: b.deliveryId?.leadId?.projectName || '',
      deliveryCompany: b.carrierId?.carrierName || '',
      deliveryId: b.deliveryId?.deliveryNumber || '',
      date: b.selectedAt,
      cost: round2(b.quotedAmount),
      approvalStatus: st === 'approved' ? 'Approved' : st ? 'Pending' : 'Pending',
      paymentStatus: st === 'approved' ? 'Paid' : 'Unpaid',
      source: 'email_freight_bid',
    }
  })
  return { rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } }
}

exports.getLogisticsSummary = async () => {
  const stats = await PaymentApproval.aggregate([
    { $match: { payeeType: { $in: ['carrier', 'delivery_company'] } } },
    {
      $group: {
        _id: null,
        totalCost: { $sum: '$amount' },
        pendingCount: { $sum: { $cond: [{ $in: ['$status', ['pending', 'under_review']] }, 1, 0] } },
        disputedCount: { $sum: { $cond: [{ $eq: ['$status', 'disputed'] }, 1, 0] } },
      },
    },
  ])
  const s = stats[0] || {}
  const freightSelected = await FreightBid.aggregate([
    { $match: { status: 'selected' } },
    { $group: { _id: null, total: { $sum: '$quotedAmount' } } },
  ])
  const bidTotal = freightSelected[0]?.total || 0
  return {
    totalLogisticsCost: round2((s.totalCost || 0) + bidTotal),
    totalSavings: 0,
    pendingInvoices: s.pendingCount || 0,
    disputedItems: s.disputedCount || 0,
  }
}

exports.listLogisticsRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = { payeeType: { $in: ['carrier', 'delivery_company'] } }
  if (query.status) filter.status = query.status
  if (query.projectId || query.leadId) filter.leadId = query.projectId || query.leadId
  const [rows, total] = await Promise.all([
    PaymentApproval.find(filter).populate('leadId', 'projectName').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PaymentApproval.countDocuments(filter),
  ])
  const mapped = rows.map((r) => ({
    id: r._id,
    approvalId: r._id,
    deliveryId: r.invoiceNumber || r.paymentId,
    deliveryCompany: r.payee,
    project: r.leadId?.projectName || '',
    finalAmount: round2(r.amount),
    date: r.createdAt,
    approvalStatus: r.status === 'approved' ? 'Approved' : 'Pending',
    paymentStatus: r.paidAt || r.status === 'approved' ? 'Paid' : 'Unpaid',
    status: r.paidAt || r.status === 'approved' ? 'Paid' : 'Unpaid',
  }))
  return { rows: mapped, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } }
}

exports.lookupDeliveryForLogistics = async (deliveryRef) => {
  const delivery = await Delivery.findOne({
    $or: [{ _id: deliveryRef }, { deliveryNumber: deliveryRef }],
  })
    .populate('leadId', 'projectName jobId')
    .lean()
  if (!delivery) return null
  return {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    project: delivery.leadId?.projectName || '',
    leadId: delivery.leadId?._id,
    deliveryCompany: delivery.receivingPoc || '',
  }
}

exports.createLogisticsCost = async (body, userId, generateExpenseId) => {
  const delivery = await Delivery.findById(body.deliveryId)
  if (!delivery) return { error: 'Delivery not found' }
  const expense = await Expense.create({
    expenseId: await generateExpenseId(),
    category: 'transport',
    costPanelType: 'miscellaneous',
    date: body.date || new Date(),
    amount: Number(body.finalAmount || body.amount),
    description: body.description || `Logistics ${delivery.deliveryNumber}`,
    leadId: delivery.leadId,
    status: body.paymentStatus === 'Paid' ? 'paid' : 'pending',
    metadata: { deliveryId: delivery._id, deliveryNumber: delivery.deliveryNumber, deliveryCompany: body.deliveryCompany },
    createdBy: userId,
  })
  return { expenseId: expense.expenseId, id: expense._id }
}

exports.getVarianceSummary = async () => {
  const budgets = await ProjectBudget.find()
    .select('leadId totalBudget materialBudget logisticBudget productionBudget shipperBudget otherCost customLines')
    .lean()
  const leadIds = budgets.map((b) => b.leadId)
  const expenseMap = await aggregateProjectExpensesByLeadMap(leadIds)
  let net = 0
  let over = 0
  let under = 0
  let on = 0
  for (const b of budgets) {
    const actual = expenseMap.get(String(b.leadId))?.totalExpense || 0
    const awarded = resolveTotalBudget(b)
    const v = actual - awarded
    net += v
    const st = budgetVarianceStatus(actual, awarded)
    if (st === 'Over Budget') over += 1
    else if (st === 'Under Budget') under += 1
    else if (st === 'On Budget') on += 1
  }
  return {
    netVariance: round2(net),
    overBudget: over,
    underBudget: under,
    onBudget: on,
    overBudgetAmount: round2(Math.max(0, net)),
    underBudgetSavings: round2(Math.abs(Math.min(0, net))),
  }
}

exports.getVarianceAlerts = async () => {
  const shippers = await ShipperRequest.find({ status: 'approved' })
    .populate('leadId', 'projectName')
    .populate('vendorId', 'vendorName vendorId')
    .limit(50)
    .lean()
  const alerts = []
  for (const sr of shippers) {
    const awarded = sr.quoteValue || 0
    const approval = await PaymentApproval.findOne({ linkedType: 'delivery', notes: { $regex: String(sr._id) } })
      .select('amount status')
      .lean()
    const actual = approval?.amount ?? awarded
    const variance = actual - awarded
    const pct = awarded > 0 ? round2((variance / awarded) * 100) : 0
    if (Math.abs(pct) >= 5) {
      alerts.push({
        itemName: 'Vendor material quote',
        project: sr.leadId?.projectName || '',
        awardedAmount: round2(awarded),
        actualAmount: round2(actual),
        variance: round2(variance),
        variancePct: pct,
      })
    }
  }
  return alerts.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct)).slice(0, 10)
}

exports.getVarianceTrend = async () => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const expenseTrend = await Expense.aggregate([
    { $match: { isActive: true, date: { $gte: start } } },
    { $group: { _id: { y: { $year: '$date' }, m: { $month: '$date' } }, actual: { $sum: '$amount' } } },
    { $sort: { '_id.y': 1, '_id.m': 1 } },
  ])
  const budgetTrend = await ProjectBudget.aggregate([
    { $group: { _id: null, awarded: { $sum: '$totalBudget' } } },
  ])
  const awardedFlat = budgetTrend[0]?.awarded || 0
  return expenseTrend.map((r) => ({
    label: `${r._id.m}/${r._id.y}`,
    awardedAmount: round2(awardedFlat / Math.max(expenseTrend.length, 1)),
    actualInvoice: round2(r.actual),
  }))
}

exports.listVarianceDetails = async (query) => {
  const { page, limit, skip } = paginate(query)
  const rows = []
  const bids = await FreightBid.find({ status: 'selected' })
    .populate({ path: 'deliveryId', populate: { path: 'leadId', select: 'projectName' } })
    .populate('carrierId', 'carrierName vendorId')
    .sort({ selectedAt: -1 })
    .limit(200)
    .lean()
  for (const b of bids) {
    const awarded = b.submissionHistory?.[0]?.quotedAmount ?? b.quotedAmount ?? 0
    const approval = await PaymentApproval.findOne({ linkedType: 'freight_bid', linkedId: b._id }).lean()
    const actual = approval?.amount ?? b.quotedAmount ?? 0
    const variance = actual - awarded
    rows.push({
      project: b.deliveryId?.leadId?.projectName || '',
      description: `Freight delivery ${b.deliveryId?.deliveryNumber || ''}`,
      vendor: b.carrierId?.carrierName || '',
      vendorId: b.carrierId?.vendorId || '',
      awardedAmount: round2(awarded),
      actualInvoice: round2(actual),
      variance: round2(variance),
      approvalStatus: budgetVarianceStatus(actual, awarded),
      source: 'freight_bid',
    })
  }
  const shipperRows = await ShipperRequest.find({ status: 'approved' })
    .populate('leadId', 'projectName')
    .populate('vendorId', 'vendorName vendorId')
    .limit(100)
    .lean()
  for (const sr of shipperRows) {
    const awarded = sr.quoteValue || 0
    const actual = sr.quoteValue || 0
    const variance = 0
    rows.push({
      project: sr.leadId?.projectName || '',
      description: 'Material vendor quote (email bid)',
      vendor: sr.vendorId?.vendorName || '',
      vendorId: sr.vendorId?.vendorCode || '',
      awardedAmount: round2(awarded),
      actualInvoice: round2(actual),
      variance: round2(variance),
      approvalStatus: 'On Budget',
      source: 'shipper_request',
    })
  }
  if (query.status) {
    const filtered = rows.filter((r) => r.approvalStatus.toLowerCase().includes(query.status.toLowerCase()))
    return {
      rows: filtered.slice(skip, skip + limit),
      pagination: { page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) || 1 },
    }
  }
  return {
    rows: rows.slice(skip, skip + limit),
    pagination: { page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit) || 1 },
  }
}

exports.getRentSummary = async () => {
  const rows = await Expense.find({ isActive: true, costPanelType: 'rent' }).select('amount status').lean()
  const total = sumExpenses(rows)
  const paid = sumExpenses(rows.filter((r) => r.status === 'paid'))
  return { totalRentCost: round2(total), paidRent: round2(paid), pendingRent: round2(total - paid) }
}

const mapRentRow = (e) => ({
  id: e._id,
  expenseId: e.expenseId,
  property: e.metadata?.propertyName || e.description,
  type: e.metadata?.propertyType || '',
  location: e.metadata?.location || '',
  landlord: e.metadata?.landlord || '',
  monthlyRent: round2(e.metadata?.monthlyRent ?? e.amount),
  amount: round2(e.amount),
  date: e.date,
  dueDate: e.metadata?.dueDate || e.date,
  rentPeriod: e.metadata?.periodLabel || '',
  leaseEnd: e.metadata?.leaseEnd || null,
  daysRemaining: e.metadata?.daysRemaining ?? null,
  status: e.status === 'paid' ? 'Paid' : e.metadata?.scheduleStatus || 'Upcoming',
  paymentStatus: e.status,
  project: e.leadId?.projectName || '',
})

exports.listRentRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = panelBaseFilter('rent', query)
  const [rows, total] = await Promise.all([
    Expense.find(filter).populate('leadId', 'projectName').sort({ date: -1 }).skip(skip).limit(limit).lean(),
    Expense.countDocuments(filter),
  ])
  return {
    rows: rows.map(mapRentRow),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

exports.getRentRecordById = async (id) => {
  const expense = await Expense.findOne({ _id: id, costPanelType: 'rent', isActive: true })
    .populate('leadId', 'projectName')
    .lean()
  return expense ? mapRentRow(expense) : null
}

exports.createRentEntry = async (body, userId, generateExpenseId) => {
  const expense = await Expense.create({
    expenseId: await generateExpenseId(),
    costPanelType: 'rent',
    category: 'office',
    date: body.date,
    amount: Number(body.amount),
    description: body.propertyName || 'Rent',
    leadId: body.leadId || null,
    status: body.paymentStatus || 'pending',
    metadata: { propertyName: body.propertyName, periodLabel: body.periodLabel },
    createdBy: userId,
  })
  return expense
}

exports.getFutureSummary = async () => {
  const rows = await Expense.find({ isActive: true, costPanelType: 'future' }).select('amount metadata').lean()
  const income = sumExpenses(rows.filter((r) => r.metadata?.flowType === 'income'))
  const expense = sumExpenses(rows.filter((r) => r.metadata?.flowType !== 'income'))
  return { projectedIncome: round2(income), projectedExpense: round2(expense), net: round2(income - expense) }
}

exports.listFutureRecords = async (query) => {
  const { page, limit, skip } = paginate(query)
  const filter = panelBaseFilter('future', query)
  const [rows, total] = await Promise.all([
    Expense.find(filter).sort({ date: 1 }).skip(skip).limit(limit).lean(),
    Expense.countDocuments(filter),
  ])
  return {
    rows: rows.map((e) => ({
      id: e._id,
      date: e.date,
      label: e.description,
      flowType: e.metadata?.flowType || 'expense',
      amount: round2(e.amount),
      projectId: e.leadId,
      status: e.status,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

exports.createFutureEntry = async (body, userId, generateExpenseId) => {
  return Expense.create({
    expenseId: await generateExpenseId(),
    costPanelType: 'future',
    category: body.flowType === 'income' ? 'other' : 'other',
    date: body.date,
    amount: Number(body.amount),
    description: body.label || body.description,
    leadId: body.leadId || null,
    status: 'pending',
    metadata: { flowType: body.flowType || 'expense' },
    createdBy: userId,
  })
}

exports.updatePanelExpense = async (id, body, costPanelType) => {
  const expense = await Expense.findOne({ _id: id, costPanelType, isActive: true })
  if (!expense) return null
  if (body.amount != null) expense.amount = body.amount
  if (body.date) expense.date = body.date
  if (body.status) expense.status = body.status
  if (body.metadata) expense.metadata = { ...expense.metadata, ...body.metadata }
  await expense.save()
  return expense
}

exports.deactivatePanelExpense = async (id, costPanelType) => {
  const expense = await Expense.findOne({ _id: id, costPanelType, isActive: true })
  if (!expense) return false
  expense.isActive = false
  await expense.save()
  return true
}
