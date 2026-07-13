const Invoice = require('../../models/Invoice')
const Expense = require('../../models/Expense')
const ProjectBudget = require('../../models/ProjectBudget')
const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getWipProfit = asyncHandler(async (req, res) => {
  const leads = await Lead.find({
    lifecycleStatus: { $in: ['po_received', 'in_production', 'dispatched', 'delivered', 'payment_done'] },
    isTerminated: { $ne: true },
  }).select('_id projectName jobId lifecycleStatus').lean()

  const leadIds = leads.map((l) => l._id)

  const [invoices, expenses, budgets] = await Promise.all([
    Invoice.find({ leadId: { $in: leadIds } }).select('leadId totalAmount status').lean(),
    Expense.find({ leadId: { $in: leadIds }, isActive: true }).select('leadId amount category').lean(),
    ProjectBudget.find({ leadId: { $in: leadIds } }).lean(),
  ])

  const invoiceByLead = {}
  for (const inv of invoices) {
    const key = String(inv.leadId)
    if (!invoiceByLead[key]) invoiceByLead[key] = { totalInvoiced: 0, totalReceived: 0 }
    invoiceByLead[key].totalInvoiced += inv.totalAmount
    if (inv.status === 'paid') invoiceByLead[key].totalReceived += inv.totalAmount
  }

  const expenseByLead = {}
  for (const exp of expenses) {
    const key = String(exp.leadId)
    if (!expenseByLead[key]) expenseByLead[key] = { total: 0, material: 0, labour: 0, logistics: 0 }
    expenseByLead[key].total += exp.amount
    if (exp.category === 'materials') expenseByLead[key].material += exp.amount
    if (exp.category === 'labour') expenseByLead[key].labour += exp.amount
    if (['transport', 'logistics'].includes(exp.category)) expenseByLead[key].logistics += exp.amount
  }

  const budgetByLead = {}
  for (const b of budgets) {
    budgetByLead[String(b.leadId)] = b
  }

  let totalProjectValue = 0
  let totalCostToDate = 0
  const projects = []

  for (const lead of leads) {
    const key = String(lead._id)
    const inv = invoiceByLead[key] || { totalInvoiced: 0, totalReceived: 0 }
    const exp = expenseByLead[key] || { total: 0, material: 0, labour: 0, logistics: 0 }
    const budget = budgetByLead[key]

    const revenue = inv.totalInvoiced
    const totalCost = exp.total
    const netProfit = revenue - totalCost
    const profitMargin = revenue > 0 ? Math.round((netProfit / revenue) * 100 * 10) / 10 : 0
    const estimated = budget?.totalBudget || 0
    const variance = totalCost - estimated

    totalProjectValue += revenue
    totalCostToDate += totalCost

    projects.push({
      leadId: lead._id,
      projectId: lead.jobId,
      projectName: lead.projectName,
      lifecycleStatus: lead.lifecycleStatus,
      revenue,
      totalCost,
      netProfit,
      profitMargin,
      estimated,
      actual: totalCost,
      variance,
      costBreakdown: {
        material: exp.material,
        labour: exp.labour,
        logistics: exp.logistics,
        other: exp.total - exp.material - exp.labour - exp.logistics,
      },
    })
  }

  const currentWipProfit = totalProjectValue - totalCostToDate
  const profitMargin = totalProjectValue > 0
    ? Math.round((currentWipProfit / totalProjectValue) * 100 * 10) / 10
    : 0

  const sorted = [...projects].sort((a, b) => b.profitMargin - a.profitMargin)
  const mostProfitable = sorted.slice(0, 5).map((p) => ({
    leadId: p.leadId,
    projectName: p.projectName,
    profitMargin: p.profitMargin,
    netProfit: p.netProfit,
  }))
  const decreasingMargin = sorted.slice(-3).reverse().map((p) => ({
    leadId: p.leadId,
    projectName: p.projectName,
    profitMargin: p.profitMargin,
    netProfit: p.netProfit,
  }))

  return success(res, {
    summary: {
      totalProjectValue,
      totalCostToDate,
      currentWipProfit,
      profitMargin,
    },
    mostProfitable,
    decreasingMargin,
    projects,
  })
})

exports.getProjectCostAnalysis = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, category, leadId } = req.query
  const filter = { isActive: true }
  if (leadId) filter.leadId = leadId
  if (category) filter.category = category

  const skip = (Number(page) - 1) * Number(limit)
  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('leadId', 'projectName jobId')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Expense.countDocuments(filter),
  ])

  const budgets = leadId
    ? await ProjectBudget.find({ leadId }).lean()
    : []
  const budgetMap = {}
  for (const b of budgets) budgetMap[String(b.leadId)] = b.totalBudget

  const rows = expenses.map((e) => {
    const estimated = budgetMap[String(e.leadId)] || 0
    const variance = estimated ? (((e.amount - estimated) / estimated) * 100).toFixed(1) + '%' : null
    return {
      expenseId: e._id,
      project: e.leadId?.projectName || '',
      projectId: e.leadId?.jobId || '',
      category: e.category,
      estimated,
      actual: e.amount,
      variance,
      date: e.date,
      description: e.description,
    }
  })

  return success(res, { rows, total })
})

exports.getOrderValueVsPlantCosts = asyncHandler(async (req, res) => {
  const leads = await Lead.find({
    lifecycleStatus: { $nin: ['initial_contact', 'qualified', 'proposal_sent'] },
  }).select('_id').lean()
  const leadIds = leads.map((l) => l._id)

  const [invoices, expenses] = await Promise.all([
    Invoice.find({ leadId: { $in: leadIds } }).select('totalAmount status').lean(),
    Expense.find({ leadId: { $in: leadIds }, isActive: true }).select('amount').lean(),
  ])

  const totalOrderValue = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalPlantCosts = expenses.reduce((s, e) => s + e.amount, 0)
  const projectedProfit = totalOrderValue - totalPlantCosts

  return success(res, { totalOrderValue, totalPlantCosts, projectedProfit })
})
