const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound } = require('../../utils/apiResponse')
const pageActivityService = require('../../services/pageActivity.service')

exports.logPageVisit = asyncHandler(async (req, res) => {
  const result = await pageActivityService.logPageVisit(req.user._id, req.body)
  return success(res, result, 'Page visit logged')
})

exports.getMyPageActivity = asyncHandler(async (req, res) => {
  const result = await pageActivityService.getUserPageActivity(req.user._id)
  if (!result) return notFound(res, 'User not found')
  return success(res, result)
})
