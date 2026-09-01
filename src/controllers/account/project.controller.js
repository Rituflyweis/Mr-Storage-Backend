const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { enrichLeadDocument } = require('../../utils/leadProjectId')

exports.getProjects = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const { status, search } = req.query

  // Default scope stays "financially relevant" projects (payment done / delivered) — an
  // explicit `status` widens/narrows that instead of it being permanently hardcoded.
  const filter = {
    lifecycleStatus: status ? status : { $in: ['payment_done', 'delivered'] },
    ...dateFilter,
  }
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [{ projectName: regex }, { jobId: regex }]
  }

  const projects = await Lead.find(filter)
    .populate('customerId')
    .populate('assignedSales', 'name email role')
    .sort({ updatedAt: -1 })
    .lean()

  return success(res, { projects: projects.map(enrichLeadDocument) })
})
