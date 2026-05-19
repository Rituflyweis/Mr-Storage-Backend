const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const ProjectBudget = require('../../models/ProjectBudget')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')

exports.getOverview = asyncHandler(async (req, res) => {
  const base = buildDateFilter(req.query)

  const [quotedAgg, invoicedAgg, paidAgg, budgetAgg] = await Promise.all([
    Lead.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$quoteValue' } } }]),
    Invoice.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([{ $match: { ...base, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    ProjectBudget.aggregate([{ $match: base }, { $group: { _id: null, material: { $sum: '$materialBudget' }, logistics: { $sum: '$logisticBudget' } } }]),
  ])

  const totalQuoted = quotedAgg[0]?.total || 0
  const totalInvoiced = invoicedAgg[0]?.total || 0
  const totalPaid = paidAgg[0]?.total || 0
  const totalMaterialCost = budgetAgg[0]?.material || 0
  const totalPending = totalInvoiced - totalPaid
  const overallMargin = totalPaid > 0 ? Math.round(((totalPaid - totalMaterialCost) / totalPaid) * 100) : 0

  return success(res, { totalQuoted, totalInvoiced, totalPaid, totalPending, totalMaterialCost, overallMargin })
})

exports.getPerProject = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const base = buildDateFilter(req.query)

  const leads = await Lead.find({ ...base, quoteValue: { $gt: 0 } })
    .populate('customerId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(Number(limit)).lean()

  const projects = await Promise.all(leads.map(async (lead) => {
    const [invoiceAgg, budget] = await Promise.all([
      Invoice.aggregate([
        { $match: { leadId: lead._id } },
        { $group: { _id: null,
            totalInvoiced: { $sum: '$totalAmount' },
            totalPaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$totalAmount', 0] } }
        }}
      ]),
      ProjectBudget.findOne({ leadId: lead._id }).lean()
    ])

    const totalInvoiced = invoiceAgg[0]?.totalInvoiced || 0
    const totalPaid = invoiceAgg[0]?.totalPaid || 0
    const materialBudget = budget?.materialBudget || 0
    const freightBudget = budget?.logisticBudget || 0
    const totalCost = materialBudget + freightBudget
    const netMargin = totalPaid - totalCost
    const marginPct = totalPaid > 0 ? Math.round((netMargin / totalPaid) * 100) : 0

    return {
      leadId: lead._id,
      projectName: lead.projectName,
      customerName: `${lead.customerId?.firstName || ''} ${lead.customerId?.lastName || ''}`.trim(),
      quoteValue: lead.quoteValue,
      totalInvoiced, totalPaid, materialBudget, freightBudget, totalCost, netMargin, marginPct
    }
  }))

  const total = await Lead.countDocuments({ ...base, quoteValue: { $gt: 0 } })
  return success(res, { projects, total, page: Number(page), limit: Number(limit) })
})
