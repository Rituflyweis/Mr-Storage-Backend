const Invoice = require('../models/Invoice')
const Expense = require('../models/Expense')
const Lead = require('../models/Lead')
const FreightBid = require('../models/FreightBid')
const PaymentApproval = require('../models/PaymentApproval')
const ProjectBudget = require('../models/ProjectBudget')
const Tax = require('../models/Tax')
const Vendor = require('../models/Vendor')
const { buildDateFilter } = require('../utils/dateRange')
const { computeInvoiceDueDate } = require('../utils/invoiceDueDate')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const customerInvoiceFilter = (query = {}) => ({
  invoiceType: { $nin: ['vendor', 'freight_carrier'] },
  ...buildDateFilter(query, 'createdAt'),
})

const expenseDateFilter = (query = {}) => ({
  isActive: true,
  ...buildDateFilter(query, 'date'),
})

const expenseCategoryLabel = (category = '') => {
  const c = String(category).toLowerCase()
  if (c === 'materials') return 'Material Purchase'
  if (c === 'labour') return 'Labour Payment'
  if (['transport', 'logistics', 'equipment'].includes(c)) return 'Freight Payment'
  return 'Expense Payment'
}

const paymentPriority = (dueDate) => {
  if (!dueDate) return 'low'
  const days = (new Date(dueDate) - Date.now()) / (24 * 60 * 60 * 1000)
  if (days <= 3) return 'high'
  if (days <= 7) return 'medium'
  return 'low'
}

const alertPriority = (daysUntil) => {
  if (daysUntil <= 3) return 'high'
  if (daysUntil <= 7) return 'medium'
  return 'low'
}

exports.computeFinancialOverview = async (query = {}) => {
  const invFilter = customerInvoiceFilter(query)
  const [invoices, expenses] = await Promise.all([
    Invoice.find(invFilter).select('status totalAmount').lean(),
    Expense.find(expenseDateFilter(query)).select('amount').lean(),
  ])

  const totalRevenue = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const outstandingPayments = invoices
    .filter((i) => ['sent', 'draft', 'overdue'].includes(i.status))
    .reduce((s, i) => s + i.totalAmount, 0)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const netProfit = totalRevenue - totalExpenses

  return {
    totalRevenue: round2(totalRevenue),
    totalExpenses: round2(totalExpenses),
    netProfit: round2(netProfit),
    outstanding: round2(outstandingPayments),
    outstandingPayments: round2(outstandingPayments),
  }
}

exports.computeInvoiceReport = async (query = {}) => {
  const invoices = await Invoice.find(customerInvoiceFilter(query)).select('status totalAmount').lean()

  const paid = invoices.filter((i) => i.status === 'paid')
  const overdue = invoices.filter((i) => i.status === 'overdue')
  const unpaid = invoices.filter((i) => ['draft', 'sent'].includes(i.status))

  const totalPaid = paid.reduce((s, i) => s + i.totalAmount, 0)
  const totalUnpaid = unpaid.reduce((s, i) => s + i.totalAmount, 0)
  const overdueAmount = overdue.reduce((s, i) => s + i.totalAmount, 0)
  const totalSales = invoices.reduce((s, i) => s + i.totalAmount, 0)

  return {
    total: invoices.length,
    totalInvoicesGenerated: invoices.length,
    paid: paid.length,
    unpaid: unpaid.length,
    overdue: overdue.length,
    totalPaid: round2(totalPaid),
    totalUnpaid: round2(totalUnpaid),
    overdueAmount: round2(overdueAmount),
    totalSales: round2(totalSales),
  }
}

exports.computeDeliveryFinance = async (query = {}) => {
  const dateFilter = buildDateFilter(query, 'createdAt')

  const [selectedBids, pendingApprovals] = await Promise.all([
    FreightBid.find({ ...dateFilter, status: 'selected' }).select('quotedAmount submissionHistory').lean(),
    PaymentApproval.aggregate([
      {
        $match: {
          payeeType: { $in: ['carrier', 'delivery_company'] },
          status: { $in: ['pending', 'under_review'] },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])

  const freightSpend = selectedBids.reduce((s, b) => s + (b.quotedAmount || 0), 0)
  const freightSavings = selectedBids.reduce((s, b) => {
    const original = b.submissionHistory?.[0]?.quotedAmount
    if (original == null || b.quotedAmount == null) return s
    return s + Math.max(0, original - b.quotedAmount)
  }, 0)

  return {
    freightSpend: round2(freightSpend),
    pendingCarrierPayments: round2(pendingApprovals[0]?.total || 0),
    freightSavings: round2(freightSavings),
  }
}

exports.computeOrderVsPlantCosts = async (query = {}) => {
  const [invoices, expenses] = await Promise.all([
    Invoice.find(customerInvoiceFilter(query)).select('totalAmount').lean(),
    Expense.find(expenseDateFilter(query)).select('amount').lean(),
  ])

  const totalOrderValue = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalPlantCosts = expenses.reduce((s, e) => s + e.amount, 0)

  return {
    totalOrderValue: round2(totalOrderValue),
    totalPlantCosts: round2(totalPlantCosts),
    projectedProfit: round2(totalOrderValue - totalPlantCosts),
  }
}

exports.computeRecentTransactions = async (query = {}, limit = 10) => {
  const cap = Math.min(Number(limit) || 10, 50)
  const invDateFilter = buildDateFilter(query, 'paidAt')
  const expDateFilter = buildDateFilter(query, 'date')

  const [invoices, expenses] = await Promise.all([
    Invoice.find({ invoiceType: { $nin: ['vendor', 'freight_carrier'] }, status: 'paid', ...invDateFilter })
      .sort({ paidAt: -1 })
      .limit(cap)
      .populate('leadId', 'projectName')
      .populate('customerId', 'firstName lastName company')
      .lean(),
    Expense.find({ ...expenseDateFilter(query), ...expDateFilter })
      .sort({ date: -1 })
      .limit(cap)
      .populate('leadId', 'projectName')
      .lean(),
  ])

  const rows = [
    ...invoices.map((i) => {
      const customerName = i.customerId?.company
        || [i.customerId?.firstName, i.customerId?.lastName].filter(Boolean).join(' ')
        || i.leadId?.projectName
        || 'Customer'
      return {
        id: i._id,
        type: 'invoice',
        label: 'Payment Received',
        entityName: customerName,
        date: i.paidAt || i.date,
        amount: round2(i.totalAmount),
        direction: 'credit',
        status: 'Completed',
        invoiceNumber: i.invoiceNumber,
        raw: i,
      }
    }),
    ...expenses.map((e) => ({
      id: e._id,
      type: 'expense',
      label: expenseCategoryLabel(e.category),
      entityName: e.leadId?.projectName || e.description || 'Expense',
      date: e.date,
      amount: round2(e.amount),
      direction: 'debit',
      status: e.status === 'paid' ? 'Completed' : 'Pending',
      category: e.category,
      raw: e,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, cap)

  return { transactions: rows }
}

exports.computeUpcomingPayments = async (query = {}) => {
  const daysAhead = Math.min(Math.max(Number(query.daysAhead) || 30, 1), 90)
  const now = new Date()
  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  const invoices = await Invoice.find({
    invoiceType: { $nin: ['vendor', 'freight_carrier'] },
    status: { $in: ['sent', 'draft', 'overdue'] },
  })
    .populate({
      path: 'leadId',
      select: 'projectName assignedSales',
      populate: { path: 'assignedSales', select: 'name' },
    })
    .populate('customerId', 'firstName lastName company')
    .lean()

  const upcoming = invoices
    .map((i) => {
      const dueDate = i.dueDate || computeInvoiceDueDate(i.date, i.daysToPay)
      const companyName = i.customerId?.company
        || [i.customerId?.firstName, i.customerId?.lastName].filter(Boolean).join(' ')
        || i.leadId?.projectName
        || ''
      const salesRep = i.leadId?.assignedSales?.name || ''
      return {
        ...i,
        dueDate,
        companyName,
        paymentDescription: i.description || 'Progress Payment',
        amount: round2(i.totalAmount),
        salesRep,
        invoiceNumber: i.invoiceNumber,
        priority: paymentPriority(dueDate),
      }
    })
    .filter((i) => i.dueDate && i.dueDate >= now && i.dueDate <= horizon)
    .sort((a, b) => a.dueDate - b.dueDate)

  return { upcoming }
}

exports.computeFinancialAlerts = async (query = {}) => {
  const limit = Math.min(Number(query.limit) || 8, 20)
  const now = new Date()
  const alerts = []

  const [overdueInvoices, pendingTaxes, disputedPayments] = await Promise.all([
    Invoice.find({
      invoiceType: { $nin: ['vendor', 'freight_carrier'] },
      status: { $in: ['overdue', 'sent'] },
    })
      .populate('customerId', 'company firstName lastName')
      .populate('leadId', 'projectName')
      .sort({ dueDate: 1 })
      .limit(20)
      .lean(),
    Tax.find({ status: 'pending' }).sort({ dueDate: 1 }).limit(10).lean(),
    PaymentApproval.find({ status: 'disputed' }).sort({ updatedAt: -1 }).limit(10).lean(),
  ])

  for (const inv of overdueInvoices) {
    const dueDate = inv.dueDate || computeInvoiceDueDate(inv.date, inv.daysToPay)
    if (inv.status !== 'overdue' && (!dueDate || dueDate >= now)) continue
    const name = inv.customerId?.company
      || inv.leadId?.projectName
      || 'Customer'
    const daysUntil = dueDate ? Math.ceil((dueDate - now) / (24 * 60 * 60 * 1000)) : 0
    alerts.push({
      id: String(inv._id),
      type: 'invoice_due',
      message: `Payment due from ${name} — $${round2(inv.totalAmount).toLocaleString('en-US')}`,
      priority: alertPriority(daysUntil),
      dueDate,
      amount: round2(inv.totalAmount),
    })
  }

  for (const tax of pendingTaxes) {
    if (!tax.dueDate) continue
    const daysUntil = Math.ceil((new Date(tax.dueDate) - now) / (24 * 60 * 60 * 1000))
    if (daysUntil > 14) continue
    alerts.push({
      id: String(tax._id),
      type: 'tax_filing',
      message: `Tax filing deadline (${tax.state || 'State'}) in ${Math.max(daysUntil, 0)} days`,
      priority: alertPriority(daysUntil),
      dueDate: tax.dueDate,
      amount: round2(tax.amount),
    })
  }

  for (const p of disputedPayments) {
    alerts.push({
      id: String(p._id),
      type: 'payment_dispute',
      message: `Disputed payment: ${p.payee} — $${round2(p.amount).toLocaleString('en-US')}`,
      priority: 'high',
      dueDate: p.dueDate || null,
      amount: round2(p.amount),
    })
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 }
  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return { alerts: alerts.slice(0, limit) }
}

exports.computeTopCarriers = async (query = {}, limit = 5) => {
  const cap = Math.min(Number(limit) || 5, 20)
  const dateFilter = buildDateFilter(query, 'createdAt')

  const rows = await FreightBid.aggregate([
    { $match: { ...dateFilter, status: 'selected' } },
    {
      $group: {
        _id: '$carrierId',
        spend: { $sum: '$quotedAmount' },
        deliveries: { $sum: 1 },
      },
    },
    { $sort: { spend: -1 } },
    { $limit: cap },
    {
      $lookup: {
        from: 'freightcarriers',
        localField: '_id',
        foreignField: '_id',
        as: 'carrier',
      },
    },
    { $unwind: { path: '$carrier', preserveNullAndEmptyArrays: true } },
  ])

  return {
    carriers: rows.map((r) => ({
      carrierId: r._id,
      name: r.carrier?.carrierName || 'Unknown carrier',
      spend: round2(r.spend),
      deliveries: r.deliveries,
    })),
  }
}

exports.computeTopVendors = async (query = {}, limit = 5) => {
  const cap = Math.min(Number(limit) || 5, 20)
  const dateFilter = buildDateFilter(query, 'createdAt')

  const rows = await PaymentApproval.aggregate([
    { $match: { payeeType: 'vendor', ...dateFilter } },
    { $group: { _id: '$payee', amount: { $sum: '$amount' } } },
    { $sort: { amount: -1 } },
    { $limit: cap },
  ])

  const vendorNames = rows.map((r) => r._id)
  const vendors = await Vendor.find({ vendorName: { $in: vendorNames } })
    .select('vendorName status contactName')
    .lean()
  const vendorByName = Object.fromEntries(vendors.map((v) => [v.vendorName, v]))

  return {
    vendors: rows.map((r) => {
      const v = vendorByName[r._id]
      return {
        vendorId: v?._id || null,
        name: r._id,
        contactName: v?.contactName || '',
        amount: round2(r.amount),
        status: v?.status === 'inactive' ? 'Expired' : 'Active',
      }
    }),
  }
}

exports.computeProjectBudgetVsActual = async (query = {}, limit = 10) => {
  const cap = Math.min(Number(limit) || 10, 50)
  const budgets = await ProjectBudget.find()
    .populate('leadId', 'projectName jobId updatedAt')
    .sort({ updatedAt: -1 })
    .limit(cap)
    .lean()

  const leadIds = budgets.map((b) => b.leadId?._id).filter(Boolean)

  const actualAgg = await Expense.aggregate([
    { $match: { leadId: { $in: leadIds }, isActive: true } },
    { $group: { _id: '$leadId', total: { $sum: '$amount' } } },
  ])

  const actualMap = Object.fromEntries(actualAgg.map((r) => [String(r._id), r.total]))

  const projects = budgets.map((b) => {
    const key = String(b.leadId?._id)
    const material = round2(b.materialBudget || 0)
    const estimated = round2(b.totalBudget || 0)
    const actual = round2(actualMap[key] || 0)
    const variance = round2(actual - estimated)
    return {
      leadId: b.leadId?._id,
      projectName: b.leadId?.projectName || '',
      jobId: b.leadId?.jobId || '',
      material,
      estimated,
      actual,
      variance,
      varianceDirection: variance > 0 ? 'over' : variance < 0 ? 'under' : 'on',
      date: b.updatedAt || b.createdAt,
    }
  })

  return { projects }
}

exports.computeDashboardOverview = async (query = {}) => {
  const [
    financialOverview,
    invoiceReport,
    deliveryFinance,
    orderVsPlantCosts,
    recentTransactions,
    alerts,
    topCarriers,
    topVendors,
    upcomingPayments,
    projectBudgetVsActual,
  ] = await Promise.all([
    exports.computeFinancialOverview(query),
    exports.computeInvoiceReport(query),
    exports.computeDeliveryFinance(query),
    exports.computeOrderVsPlantCosts(query),
    exports.computeRecentTransactions(query, query.transactionsLimit || 5),
    exports.computeFinancialAlerts(query),
    exports.computeTopCarriers(query, query.carriersLimit || 5),
    exports.computeTopVendors(query, query.vendorsLimit || 5),
    exports.computeUpcomingPayments(query),
    exports.computeProjectBudgetVsActual(query, query.budgetRowsLimit || 6),
  ])

  return {
    financialOverview,
    invoiceReport,
    deliveryFinance,
    orderVsPlantCosts,
    recentTransactions: recentTransactions.transactions,
    alerts: alerts.alerts,
    topCarriers: topCarriers.carriers,
    topVendors: topVendors.vendors,
    upcomingPayments: upcomingPayments.upcoming,
    projectBudgetVsActual: projectBudgetVsActual.projects,
  }
}
