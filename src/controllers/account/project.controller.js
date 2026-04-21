const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getProjects = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const projects = await Lead.find({
    lifecycleStatus: { $in: ['payment_done', 'delivered'] },
    ...dateFilter,
  })
    .populate('customerId')
    .populate('assignedSales', 'name email role')
    .sort({ updatedAt: -1 })
    .lean()

  return success(res, { projects })
})
