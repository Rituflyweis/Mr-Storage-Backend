const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const Expense = require('../models/Expense')
const ProjectBudget = require('../models/ProjectBudget')
const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const { PO_PROJECT_MATCH } = require('../utils/customerPoFilter')
const { buildPeriodDateFilter } = require('../utils/dateRange')
const { isInvoiceOverdue } = require('../utils/invoiceScope')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const customerDisplayName = (c) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.firstName || ''

const formatPhone = (phone) => {
  if (!phone) return ''
  const cc = phone.countryCode ? String(phone.countryCode).trim() : ''
  const num = phone.number ? String(phone.number).trim() : ''
  return [cc, num].filter(Boolean).join(' ').trim()
}

const resolveCustomer = async (customerIdOrCode) => {
  if (!customerIdOrCode) return null
  const byMongo = await Customer.findById(customerIdOrCode).lean()
  if (byMongo) return byMongo
  return Customer.findOne({ customerId: customerIdOrCode }).lean()
}

const buildCustomerSearchFilter = (search) => {
  if (!search?.trim()) return null
  const regex = new RegExp(search.trim(), 'i')
  return {
    $or: [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { customerId: regex },
      { 'phone.number': regex },
      { company: regex },
    ],
  }
}

const mapProjectStatusLabel = (lifecycleStatus) => {
  if (['delivered', 'payment_done'].includes(lifecycleStatus)) return 'Completed'
  return 'In progress'
}

const mapInvoiceListRow = (inv, now = new Date()) => {
  const amount = round2(inv.totalAmount || 0)
  const isPaid = inv.status === 'paid'
  const overdue = !isPaid && isInvoiceOverdue(inv, now)
  return {
    invoiceId: inv._id,
    invoiceNumber: inv.invoiceNumber || '',
    dueDate: inv.dueDate || inv.date || null,
    amount,
    paid: isPaid ? amount : 0,
    amountDue: isPaid ? 0 : amount,
    status: isPaid ? 'Paid' : 'Unpaid',
    invoiceStatus: overdue ? 'overdue' : inv.status,
    leadId: inv.leadId,
    projectName: inv.leadId?.projectName || '',
  }
}

exports.resolveCustomer = resolveCustomer

exports.computeCustomerStats = async (query = {}) => {
  const dateFilter = buildPeriodDateFilter(query, 'createdAt')
  const baseFilter = { ...dateFilter }

  const [totalCustomers, activeCustomers, newInPeriod] = await Promise.all([
    Customer.countDocuments(baseFilter),
    Customer.countDocuments({ ...baseFilter, isActive: true }),
    Customer.countDocuments(baseFilter),
  ])

  const returningAgg = await Lead.aggregate([
    { $match: PO_PROJECT_MATCH },
    { $group: { _id: '$customerId', projectCount: { $sum: 1 } } },
    { $match: { projectCount: { $gte: 2 } } },
    { $count: 'returning' },
  ])
  let returningCustomers = returningAgg[0]?.returning || 0

  if (Object.keys(dateFilter).length) {
    const idsInPeriod = await Customer.find(baseFilter).distinct('_id')
    const returningInSet = await Lead.aggregate([
      { $match: { ...PO_PROJECT_MATCH, customerId: { $in: idsInPeriod } } },
      { $group: { _id: '$customerId', projectCount: { $sum: 1 } } },
      { $match: { projectCount: { $gte: 2 } } },
      { $count: 'returning' },
    ])
    returningCustomers = returningInSet[0]?.returning || 0
  }

  return {
    totalCustomers,
    activeCustomers,
    newCustomersThisMonth: newInPeriod,
    returningCustomers,
  }
}

exports.listCustomers = async (query = {}) => {
  const dateFilter = buildPeriodDateFilter(query, 'createdAt')
  const { page = 1, limit = 20, search } = query

  const filter = { ...dateFilter }
  const searchFilter = buildCustomerSearchFilter(search)
  if (searchFilter) Object.assign(filter, searchFilter)

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select('_id customerId firstName lastName email phone isActive createdAt company location')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Customer.countDocuments(filter),
  ])

  const customerIds = customers.map((c) => c._id)
  const projectCounts = await Lead.aggregate([
    { $match: { customerId: { $in: customerIds }, ...PO_PROJECT_MATCH } },
    { $group: { _id: '$customerId', count: { $sum: 1 } } },
  ])
  const countMap = new Map(projectCounts.map((p) => [String(p._id), p.count]))

  const rows = customers.map((c) => ({
    _id: c._id,
    customerId: c.customerId,
    customerName: customerDisplayName(c),
    phone: formatPhone(c.phone),
    email: c.email,
    status: c.isActive ? 'Active' : 'Inactive',
    totalProjects: countMap.get(String(c._id)) || 0,
    joinedDate: c.createdAt,
  }))

  return { customers: rows, total, page: parsedPage, limit: parsedLimit }
}

const aggregateCustomerFinancials = async (customerMongoId) => {
  const leads = await Lead.find({ customerId: customerMongoId, ...PO_PROJECT_MATCH })
    .select('_id jobId projectName quoteValue lifecycleStatus plannedStartDate endDate createdAt')
    .lean()
  const leadIds = leads.map((l) => l._id)

  const [budgets, expenses, invoices, deliveries] = await Promise.all([
    ProjectBudget.find({ leadId: { $in: leadIds } }).lean(),
    Expense.find({ leadId: { $in: leadIds }, isActive: true }).select('amount category leadId').lean(),
    Invoice.find({
      customerId: customerMongoId,
      invoiceType: { $nin: ['vendor', 'freight_carrier'] },
      status: { $ne: 'cancelled' },
    }).lean(),
    Delivery.find({ leadId: { $in: leadIds } }).select('_id leadId').lean(),
  ])

  const deliveryIds = deliveries.map((d) => d._id)
  const freightBids = deliveryIds.length
    ? await FreightBid.find({ deliveryId: { $in: deliveryIds }, status: 'selected' }).select('quotedAmount').lean()
    : []

  const expected = {
    revenue: 0,
    materialCost: 0,
    freightCost: 0,
    logisticsCost: 0,
    manpowerCost: 0,
    siteCost: 0,
    miscellaneous: 0,
    totalCost: 0,
    profit: 0,
    marginPct: 0,
  }

  for (const l of leads) expected.revenue += l.quoteValue || 0
  for (const b of budgets) {
    expected.materialCost += b.materialBudget || 0
    expected.freightCost += b.logisticBudget || 0
    expected.manpowerCost += b.productionBudget || 0
    expected.siteCost += b.shipperBudget || 0
    expected.miscellaneous += b.otherCost || 0
    expected.logisticsCost += 0
  }
  expected.totalCost =
    expected.materialCost +
    expected.freightCost +
    expected.logisticsCost +
    expected.manpowerCost +
    expected.siteCost +
    expected.miscellaneous
  expected.profit = expected.revenue - expected.totalCost
  expected.marginPct = expected.revenue > 0 ? round2((expected.profit / expected.revenue) * 100) : 0

  const actual = {
    revenue: 0,
    materialCost: 0,
    freightCost: 0,
    logisticsCost: 0,
    manpowerCost: 0,
    siteCost: 0,
    miscellaneous: 0,
    totalCost: 0,
    profit: 0,
    marginPct: 0,
  }

  for (const inv of invoices) {
    if (inv.status === 'paid') actual.revenue += inv.totalAmount || 0
  }
  if (actual.revenue === 0) {
    actual.revenue = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0)
  }

  for (const e of expenses) {
    const cat = String(e.category || '').toLowerCase()
    if (cat === 'materials') actual.materialCost += e.amount
    else if (cat === 'labour') actual.manpowerCost += e.amount
    else if (['transport', 'logistics'].includes(cat)) actual.logisticsCost += e.amount
    else if (['subcontractor', 'permits'].includes(cat)) actual.siteCost += e.amount
    else actual.miscellaneous += e.amount
  }
  actual.freightCost = freightBids.reduce((s, b) => s + (b.quotedAmount || 0), 0)
  actual.totalCost =
    actual.materialCost +
    actual.freightCost +
    actual.logisticsCost +
    actual.manpowerCost +
    actual.siteCost +
    actual.miscellaneous
  actual.profit = actual.revenue - actual.totalCost
  actual.marginPct = actual.revenue > 0 ? round2((actual.profit / actual.revenue) * 100) : 0

  const metricRow = (key, label) => ({
    key,
    label,
    expected: round2(expected[key]),
    actual: round2(actual[key]),
    variance: round2(actual[key] - expected[key]),
  })

  const profitabilityOverview = [
    metricRow('revenue', 'Revenue'),
    metricRow('materialCost', 'Material Cost'),
    metricRow('freightCost', 'Freight Cost'),
    metricRow('logisticsCost', 'Logistics Cost'),
    metricRow('manpowerCost', 'Manpower Cost'),
    metricRow('siteCost', 'Site Cost'),
    metricRow('miscellaneous', 'Miscellaneous'),
    metricRow('totalCost', 'Total Cost'),
    metricRow('profit', 'Profit'),
    {
      key: 'marginPct',
      label: 'Margin',
      expected: expected.marginPct,
      actual: actual.marginPct,
      variance: round2(actual.marginPct - expected.marginPct),
      unit: 'percent',
    },
  ]

  const now = new Date()
  let totalReceived = 0
  let totalInvoiced = 0
  let outstandingAmount = 0
  let overdueAmount = 0
  for (const inv of invoices) {
    const amt = inv.totalAmount || 0
    totalInvoiced += amt
    if (inv.status === 'paid') totalReceived += amt
    else if (isInvoiceOverdue(inv, now)) overdueAmount += amt
    else if (['sent', 'draft', 'overdue'].includes(inv.status)) outstandingAmount += amt
  }

  const totalQuotedValue = leads.reduce((s, l) => s + (l.quoteValue || 0), 0)
  const totalProjectCost = actual.totalCost
  const totalFreightCost = actual.freightCost
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)

  const expectedMarginPct = expected.marginPct
  const actualMarginPct = actual.marginPct

  return {
    leads,
    summary: {
      totalProjects: leads.length,
      totalProjectValue: round2(totalQuotedValue),
      totalProjectCost: round2(totalProjectCost),
      totalFreightCost: round2(totalFreightCost),
      expectedMargin: expectedMarginPct,
      actualMargin: actualMarginPct,
      totalExpenses: round2(totalExpenses),
      outstandingAmount: round2(outstandingAmount + overdueAmount),
    },
    customerRevenue: {
      totalQuotedValue: round2(totalQuotedValue),
      totalInvoiced: round2(totalInvoiced),
      totalReceived: round2(totalReceived),
      outstandingAmount: round2(outstandingAmount),
      overdue: round2(overdueAmount),
    },
    profitabilityOverview,
    invoices,
  }
}

exports.getCustomerDetail = async (customerIdOrCode, query = {}) => {
  const customer = await resolveCustomer(customerIdOrCode)
  if (!customer) return null

  const financials = await aggregateCustomerFinancials(customer._id)
  const { search, startDate, endDate, period } = query
  const projectDateFilter = buildPeriodDateFilter({ startDate, endDate, period }, 'createdAt')

  let projects = financials.leads.map((l) => ({
    leadId: l._id,
    projectId: l.jobId,
    projectName: l.projectName,
    amount: round2(l.quoteValue || 0),
    status: mapProjectStatusLabel(l.lifecycleStatus),
    lifecycleStatus: l.lifecycleStatus,
    startDate: l.plannedStartDate || l.createdAt,
    endDate: l.endDate,
  }))

  if (Object.keys(projectDateFilter).length) {
    const allowed = new Set(
      financials.leads
        .filter((l) => {
          const created = l.createdAt
          const gte = projectDateFilter.createdAt?.$gte
          const lte = projectDateFilter.createdAt?.$lte
          if (gte && created < gte) return false
          if (lte && created > lte) return false
          return true
        })
        .map((l) => String(l._id))
    )
    projects = projects.filter((p) => allowed.has(String(p.leadId)))
  }

  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    projects = projects.filter(
      (p) => regex.test(p.projectName) || regex.test(p.projectId || '')
    )
  }

  const invoiceDateFilter = buildPeriodDateFilter(query, 'createdAt')
  let invoiceRows = financials.invoices
  if (Object.keys(invoiceDateFilter).length) {
    invoiceRows = invoiceRows.filter((inv) => {
      const created = inv.createdAt
      const gte = invoiceDateFilter.createdAt?.$gte
      const lte = invoiceDateFilter.createdAt?.$lte
      if (gte && created < gte) return false
      if (lte && created > lte) return false
      return true
    })
  }
  if (search?.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    invoiceRows = invoiceRows.filter((inv) => regex.test(inv.invoiceNumber || ''))
  }

  const now = new Date()
  const projectNameByLead = new Map(financials.leads.map((l) => [String(l._id), l.projectName || '']))

  const invoices = invoiceRows
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((inv) => ({
      ...mapInvoiceListRow(inv, now),
      projectName: projectNameByLead.get(String(inv.leadId)) || '',
    }))

  return {
    profile: {
      _id: customer._id,
      customerId: customer.customerId,
      customerName: customerDisplayName(customer),
      status: customer.isActive ? 'Active' : 'Inactive',
      joinedDate: customer.createdAt,
      phone: formatPhone(customer.phone),
      email: customer.email,
      address: customer.location || '',
      company: customer.company || '',
      photo: customer.photo || null,
    },
    summary: financials.summary,
    customerRevenue: financials.customerRevenue,
    profitabilityOverview: financials.profitabilityOverview,
    projects,
    invoices,
  }
}
