const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Invoice = require('../../models/Invoice')
const Message = require('../../models/Message')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { startOfMonth, endOfMonth } = require('date-fns')

exports.getLeadStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [total, quoteReady, quoteValueAgg, paidInvoicesAgg, unread] = await Promise.all([
    Lead.countDocuments(dateFilter),
    Lead.countDocuments({ ...dateFilter, isQuoteReady: true }),
    Lead.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: '$quoteValue' } } },
    ]),
    Invoice.aggregate([
      {
        $match: {
          status: 'paid',
          paidAt: {
            $gte: startOfMonth(new Date()),
            $lte: endOfMonth(new Date()),
          },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
    Message.countDocuments({ isRead: false, senderType: 'customer' }),
  ])

  return success(res, {
    totalLeads: total,
    confirmedLeads: quoteReady,
    pipelineValue: quoteValueAgg[0]?.total || 0,
    monthlyRevenue: paidInvoicesAgg[0]?.total || 0,
    unreadMessages: unread,
  })
})

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const [total, active, newThisMonth, returningAgg] = await Promise.all([
    Customer.countDocuments(dateFilter),
    Customer.countDocuments({ ...dateFilter, isActive: true }),
    Customer.countDocuments({ createdAt: { $gte: monthStart, $lte: monthEnd } }),
    // Returning = customers with more than 1 lead total
    Lead.aggregate([
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'total' },
    ]),
  ])

  return success(res, {
    total,
    active,
    newThisMonth,
    returning: returningAgg[0]?.total || 0,
  })
})

exports.getAiVsHuman = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [withAi, withSales] = await Promise.all([
    Lead.countDocuments({ ...dateFilter, isHandedToSales: false }),
    Lead.countDocuments({ ...dateFilter, isHandedToSales: true }),
  ])

  return success(res, { withAi, withSales })
})
