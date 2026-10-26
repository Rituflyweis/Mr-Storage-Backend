const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const Invoice = require('../models/Invoice')
const Expense = require('../models/Expense')
const ProjectBudget = require('../models/ProjectBudget')
const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const WIPProfit = require('../models/WIPProfit')
const { SALES_LIFECYCLE_STAGES } = require('../config/constants')
const { findLatestContractDocument } = require('../utils/leadAgreement')
const { formatLifecycleStatusLabel } = require('../utils/employeeProfile.util')
const { isInvoiceOverdue } = require('../utils/invoiceScope')
const { withProjectIdFields } = require('../utils/leadProjectId')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const SALES_STAGE_LABELS = {
  initial_contact: 'Initial Contact',
  requirements_gathered: 'Requirements Gathered',
  proposal_sent: 'Proposal Sent',
  negotiation: 'Negotiation',
  deal_closed: 'Deal Closed',
  payment_done: 'Payment Done',
  converted_to_po: 'Converted to PO',
  sent_to_admin: 'Sent to Admin',
}

const formatPhone = (phone) => {
  if (!phone) return ''
  return [phone.countryCode, phone.number].filter(Boolean).join(' ').trim()
}

exports.resolveProject = async (projectIdOrJobId) => {
  if (!projectIdOrJobId) return null
  let lead = await Lead.findById(projectIdOrJobId)
    .populate('customerId')
    .populate('assignedSales', 'name email role')
    .lean()
  if (lead) return lead
  return Lead.findOne({ jobId: projectIdOrJobId })
    .populate('customerId')
    .populate('assignedSales', 'name email role')
    .lean()
}

const historyDateForStage = (history, stage) => {
  const entries = (history || []).filter((h) => h.stage === stage).sort(
    (a, b) => new Date(a.changedAt) - new Date(b.changedAt),
  )
  return entries.length ? entries[entries.length - 1].changedAt : null
}

const buildSalesProgressStep = (lead) => {
  const history = lead.lifecycleHistory || []
  const status = lead.lifecycleStatus
  let currentIdx = SALES_LIFECYCLE_STAGES.indexOf(status)
  if (currentIdx === -1) {
    currentIdx = SALES_LIFECYCLE_STAGES.length - 1
  }

  const steps = SALES_LIFECYCLE_STAGES.map((stage, idx) => {
    let stepStatus = 'pending'
    if (idx < currentIdx) stepStatus = 'completed'
    else if (idx === currentIdx) stepStatus = 'current'
    return {
      stepNumber: idx + 1,
      key: stage,
      label: SALES_STAGE_LABELS[stage] || stage,
      status: stepStatus,
      date: historyDateForStage(history, stage) || (idx === 0 ? lead.createdAt : null),
    }
  })

  const completedCount = steps.filter((s) => s.status === 'completed').length
  const currentKey = SALES_LIFECYCLE_STAGES[currentIdx]
  const nextKey = currentIdx < SALES_LIFECYCLE_STAGES.length - 1
    ? SALES_LIFECYCLE_STAGES[currentIdx + 1]
    : null

  const nextStepNotes = {
    payment_done: 'Convert this lead to PO after this. Automatically sent to admin and accounts.',
    converted_to_po: 'Project moves to plant and admin workflows.',
  }

  return {
    steps,
    totalSteps: SALES_LIFECYCLE_STAGES.length,
    completedSteps: completedCount,
    progressLabel: `${completedCount} of ${SALES_LIFECYCLE_STAGES.length}`,
    currentStepKey: currentKey,
    currentStepLabel: SALES_STAGE_LABELS[currentKey] || currentKey,
    lifecycleStatus: status,
    lifecycleStatusLabel: formatLifecycleStatusLabel(status),
    leadGeneratedDate: lead.createdAt,
    currentStepDate: historyDateForStage(history, currentKey) || lead.updatedAt,
    assignedSales: lead.assignedSales
      ? { _id: lead.assignedSales._id, name: lead.assignedSales.name, role: lead.assignedSales.role || 'Sales Person' }
      : null,
    priority: lead.priority || 'medium',
    nextStepLabel: nextKey ? (SALES_STAGE_LABELS[nextKey] || nextKey) : null,
    nextStepNote: nextStepNotes[currentKey] || '',
  }
}

const computeProfitabilityOverview = async (leadId, quoteValue) => {
  const [budget, expenses, deliveries] = await Promise.all([
    ProjectBudget.findOne({ leadId }).lean(),
    Expense.find({ leadId, isActive: true }).select('amount category').lean(),
    Delivery.find({ leadId }).select('_id').lean(),
  ])

  const deliveryIds = deliveries.map((d) => d._id)
  const freightBids = deliveryIds.length
    ? await FreightBid.find({ deliveryId: { $in: deliveryIds }, status: 'selected' }).select('quotedAmount').lean()
    : []

  const invoices = await Invoice.find({
    leadId,
    invoiceType: { $nin: ['vendor', 'freight_carrier'] },
    status: { $ne: 'cancelled' },
  }).select('status totalAmount').lean()

  let actualRevenue = 0
  for (const inv of invoices) {
    if (inv.status === 'paid') actualRevenue += inv.totalAmount || 0
  }
  if (!actualRevenue) {
    actualRevenue = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0)
  }

  const expected = {
    revenue: quoteValue || 0,
    materialCost: budget?.materialBudget || 0,
    freightCost: budget?.logisticBudget || 0,
    logisticsCost: 0,
    manpowerCost: budget?.productionBudget || 0,
    siteCost: budget?.shipperBudget || 0,
    miscellaneous: budget?.otherCost || 0,
    totalCost: 0,
    profit: 0,
    marginPct: 0,
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
    revenue: actualRevenue,
    materialCost: 0,
    freightCost: freightBids.reduce((s, b) => s + (b.quotedAmount || 0), 0),
    logisticsCost: 0,
    manpowerCost: 0,
    siteCost: 0,
    miscellaneous: 0,
    totalCost: 0,
    profit: 0,
    marginPct: 0,
  }

  for (const e of expenses) {
    const cat = String(e.category || '').toLowerCase()
    if (cat === 'materials') actual.materialCost += e.amount
    else if (cat === 'labour') actual.manpowerCost += e.amount
    else if (['transport', 'logistics'].includes(cat)) actual.logisticsCost += e.amount
    else if (['subcontractor', 'permits'].includes(cat)) actual.siteCost += e.amount
    else actual.miscellaneous += e.amount
  }

  actual.totalCost =
    actual.materialCost +
    actual.freightCost +
    actual.logisticsCost +
    actual.manpowerCost +
    actual.siteCost +
    actual.miscellaneous
  actual.profit = actual.revenue - actual.totalCost
  actual.marginPct = actual.revenue > 0 ? round2((actual.profit / actual.revenue) * 100) : 0

  const row = (key, label) => ({
    key,
    label,
    expected: round2(expected[key]),
    actual: round2(actual[key]),
    variance: round2(actual[key] - expected[key]),
  })

  return {
    rows: [
      row('revenue', 'Revenue'),
      row('materialCost', 'Material Cost'),
      row('freightCost', 'Freight Cost'),
      row('logisticsCost', 'Logistics Cost'),
      row('manpowerCost', 'Manpower Cost'),
      row('siteCost', 'Site Cost'),
      row('miscellaneous', 'Miscellaneous'),
      row('totalCost', 'Total Cost'),
      row('profit', 'Profit'),
      {
        key: 'marginPct',
        label: 'Margin',
        expected: expected.marginPct,
        actual: actual.marginPct,
        variance: round2(actual.marginPct - expected.marginPct),
        unit: 'percent',
      },
    ],
    expectedProfit: round2(expected.profit),
    actualProfit: round2(actual.profit),
    actualMargin: actual.marginPct,
    totalProjectCost: round2(actual.totalCost),
  }
}

const computeFinancialSummary = async (leadId, quoteValue) => {
  const now = new Date()
  const invoices = await Invoice.find({
    leadId,
    invoiceType: { $nin: ['vendor', 'freight_carrier'] },
    status: { $ne: 'cancelled' },
  }).select('status totalAmount').lean()

  let totalInvoiced = 0
  let totalReceived = 0
  let outstanding = 0
  for (const inv of invoices) {
    const amt = inv.totalAmount || 0
    totalInvoiced += amt
    if (inv.status === 'paid') totalReceived += amt
    else if (isInvoiceOverdue(inv, now) || ['sent', 'draft', 'overdue'].includes(inv.status)) {
      outstanding += amt
    }
  }

  const wip = await WIPProfit.findOne({ leadId }).lean()
  const profitability = await computeProfitabilityOverview(leadId, quoteValue)

  return {
    projectValue: round2(quoteValue || wip?.orderValue || 0),
    totalInvoiced: round2(totalInvoiced),
    totalReceived: round2(totalReceived),
    outstanding: round2(outstanding),
    totalProjectCost: profitability.totalProjectCost,
    expectedProfit: profitability.expectedProfit,
    actualProfit: profitability.actualProfit,
    actualMargin: profitability.actualMargin,
  }
}

exports.getProjectDetail = async (projectIdOrJobId) => {
  const lead = await exports.resolveProject(projectIdOrJobId)
  if (!lead || lead.isDeleted) return null

  const customer = lead.customerId
  const contract = findLatestContractDocument(lead)
  const [financialSummary, profitabilityOverview] = await Promise.all([
    computeFinancialSummary(lead._id, lead.quoteValue),
    computeProfitabilityOverview(lead._id, lead.quoteValue),
  ])

  const progressStep = buildSalesProgressStep(lead)

  const contact = customer && typeof customer === 'object'
    ? {
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim(),
      phone: formatPhone(customer.phone),
      email: customer.email,
      address: customer.location || lead.location || '',
      company: customer.company || '',
    }
    : null

  const overview = withProjectIdFields({
    leadId: lead._id,
    projectName: lead.projectName,
    jobId: lead.jobId,
    status: lead.lifecycleStatus,
    statusLabel: formatLifecycleStatusLabel(lead.lifecycleStatus),
    buildingType: lead.buildingType,
    quoteValue: round2(lead.quoteValue || 0),
    createdOn: lead.createdAt,
    location: lead.location,
    city: lead.city,
    state: lead.state,
    pincode: lead.pincode,
  }, lead.jobId)

  return {
    overview,
    contact,
    assignment: progressStep.assignedSales,
    agreement: contract
      ? {
        signed: true,
        documentName: contract.name || 'Signed contract / agreement',
        signedOn: contract.uploadedAt,
        url: contract.url || '',
      }
      : { signed: false, documentName: null, signedOn: null, url: null },
    financialSummary,
    progressStep,
    profitabilityOverview: profitabilityOverview.rows,
    actionLinks: {
      invoices: `/api/account/invoices?leadId=${lead._id}`,
      projectInvoicesBreakdown: `/api/account/invoices/project/${lead._id}/breakdown`,
      payments: `/api/account/payments/orders/${lead._id}`,
      agreement: `/api/admin/customers/${customer?._id || customer}/projects/${lead._id}/agreement`,
      quotation: `/api/sales/leads/${lead._id}`,
      bom: `/api/plant/bom/projects/${lead._id}`,
    },
    lead: withProjectIdFields(lead, lead.jobId),
  }
}
