const Lead = require('../../models/Lead')
const { buildDateFilter } = require('../../utils/dateRange')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { enrichLeadDocument } = require('../../utils/leadProjectId')
const accountProjectService = require('../../services/accountProject.service')
const { buildFinancialLeadMatch } = require('../../utils/financialProjectScope')

exports.getProjects = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const { status, search } = req.query

  // Default: PO / plant projects only; optional `status` narrows lifecycle within that scope.
  const filter = status
    ? { $and: [buildFinancialLeadMatch(), { lifecycleStatus: status }], ...dateFilter }
    : { ...buildFinancialLeadMatch(), ...dateFilter }
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

exports.getProjectDetail = asyncHandler(async (req, res) => {
  const detail = await accountProjectService.getProjectDetail(req.params.projectId)
  if (!detail) return notFound(res, 'Project not found')
  return success(res, detail)
})
