const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Invoice = require('../../models/Invoice')
const Message = require('../../models/Message')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { startOfMonth, endOfMonth } = require('date-fns')

exports.getLeadStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)
  const base = { assignedSales: salesId, ...dateFilter }

  const [total, quoteReady, quoteValueAgg, unread] = await Promise.all([
    Lead.countDocuments(base),
    Lead.countDocuments({ ...base, isQuoteReady: true }),
    Lead.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$quoteValue' } } }]),
    Message.countDocuments({
      isRead: false,
      senderType: 'customer',
      leadId: { $in: await Lead.find(base).distinct('_id') },
    }),
  ])

  return success(res, {
    totalLeads: total,
    confirmedLeads: quoteReady,
    pipelineValue: quoteValueAgg[0]?.total || 0,
    unreadMessages: unread,
  })
})

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)

  const myLeads = await Lead.find({ assignedSales: salesId }).distinct('customerId')
  const base = { _id: { $in: myLeads }, ...dateFilter }

  const now = new Date()
  const [total, active, newThisMonth] = await Promise.all([
    Customer.countDocuments(base),
    Customer.countDocuments({ ...base, isActive: true }),
    Customer.countDocuments({ ...base, createdAt: { $gte: startOfMonth(now), $lte: endOfMonth(now) } }),
  ])

  return success(res, { total, active, newThisMonth })
})
