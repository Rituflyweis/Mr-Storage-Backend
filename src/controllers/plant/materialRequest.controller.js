const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, forbidden } = require('../../utils/apiResponse')
const materialRequestList = require('../../services/materialRequestList.service')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')
const MaterialRequest = require('../../models/MaterialRequest')
const { MR_STATUSES, MR_PRIORITIES } = require('../../models/MaterialRequest')
const User = require('../../models/User')

const resolvePlantScopedLeadIds = async (req) => {
  const ids = await getScopedLeadIds(req)
  return ids.map(String)
}

exports.listMaterialRequests = asyncHandler(async (req, res) => {
  const scopedLeadIds = await resolvePlantScopedLeadIds(req)
  const data = await materialRequestList.listMaterialRequests(req.query, {
    page: req.query.page,
    limit: req.query.limit,
    scopedLeadIds,
  })
  return success(res, { ...data, scope: 'plant' })
})

exports.getMaterialRequestDetail = asyncHandler(async (req, res) => {
  const scopedLeadIds = await resolvePlantScopedLeadIds(req)
  const result = await materialRequestList.getMaterialRequestById(req.params.requestId, { scopedLeadIds })
  if (!result) return notFound(res, 'Material request not found')
  if (result.forbidden) return forbidden(res, 'This request is not on a plant-scoped project')
  return success(res, { materialRequest: result.request })
})

exports.getMaterialRequestFilters = asyncHandler(async (req, res) => {
  const scopedLeadIds = await resolvePlantScopedLeadIds(req)
  const baseFilter = await materialRequestList.buildMaterialRequestListFilter({}, { scopedLeadIds })

  const [departments, requesters] = await Promise.all([
    MaterialRequest.distinct('department', { ...baseFilter, department: { $ne: '' } }),
    MaterialRequest.distinct('requestedBy', { ...baseFilter, requestedBy: { $ne: null } }),
  ])

  const users = requesters.length
    ? await User.find({ _id: { $in: requesters } }).select('name role').lean()
    : []

  return success(res, {
    statuses: MR_STATUSES,
    priorities: MR_PRIORITIES,
    sources: ['customer', 'construction'],
    departments,
    requestedBy: users.map((u) => ({ _id: u._id, name: u.name, role: u.role })),
  })
})
