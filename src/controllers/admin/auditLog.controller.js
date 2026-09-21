const asyncHandler = require('../../utils/asyncHandler')
const { success } = require('../../utils/apiResponse')
const { listAuditLogs } = require('../../services/auditLogQuery.service')

exports.listAuditLogs = asyncHandler(async (req, res) => {
  const result = await listAuditLogs(req.query)
  return success(res, result)
})
