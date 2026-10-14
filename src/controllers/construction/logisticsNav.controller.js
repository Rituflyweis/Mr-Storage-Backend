const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, forbidden } = require('../../utils/apiResponse')
const logisticsNav = require('../../services/constructionLogisticsNav.service')

/** GET /logistics/projects — step 1 (packing lists, labels, bundle scan share this) */
exports.getLogisticsProjects = asyncHandler(async (req, res) => {
  const data = await logisticsNav.listLogisticsProjects(req.query)
  return success(res, data)
})

/** GET /logistics/projects/:leadId/loads — step 2 */
exports.getLogisticsProjectLoads = asyncHandler(async (req, res) => {
  const result = await logisticsNav.listLoadsForProject(req.params.leadId, req.query)
  if (result.error === 'not_found') return notFound(res, 'Project not found')
  if (result.error === 'forbidden') return forbidden(res, 'Project not in construction scope')
  return success(res, result)
})

/** GET /logistics/loads/:packingListId/bundles — step 3 */
exports.getLogisticsLoadBundles = asyncHandler(async (req, res) => {
  const result = await logisticsNav.listBundlesForLoad(req.params.packingListId, req.query)
  if (result.error === 'not_found') return notFound(res, 'Load / packing list not found')
  if (result.error === 'forbidden') return forbidden(res, 'Project not in construction scope')
  return success(res, result)
})
