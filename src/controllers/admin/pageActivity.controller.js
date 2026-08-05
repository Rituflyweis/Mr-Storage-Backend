const asyncHandler = require('../../utils/asyncHandler')
const { success } = require('../../utils/apiResponse')
const pageActivityService = require('../../services/pageActivity.service')

exports.getUsersPageActivity = asyncHandler(async (req, res) => {
  const result = await pageActivityService.getUsersPageActivity(req.query)
  return success(res, result)
})
