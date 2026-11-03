const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const accountProjectService = require('../../services/accountProject.service')

exports.getProjects = asyncHandler(async (req, res) => {
  const projects = await accountProjectService.listAccountProjects(req.query)
  return success(res, { projects })
})

/** Same as GET /projects, but only leads with at least one customer invoice (non-cancelled). */
exports.getConfirmedProjects = asyncHandler(async (req, res) => {
  const projects = await accountProjectService.listAccountProjects(req.query, {
    confirmedInvoicedOnly: true,
  })
  return success(res, { projects })
})

exports.getProjectDetail = asyncHandler(async (req, res) => {
  const detail = await accountProjectService.getProjectDetail(req.params.projectId)
  if (!detail) return notFound(res, 'Project not found')
  return success(res, detail)
})
