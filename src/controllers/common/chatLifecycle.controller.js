const Lead = require('../../models/Lead')
const chatLifecycle = require('../../services/chat/chatLifecycle.service')
const { success, notFound, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const assertStaffLeadAccess = async (leadId, user) => {
  if (user.role === 'admin') return { ok: true }

  const lead = await Lead.findById(leadId).select('assignedSales').lean()
  if (!lead) return { error: 'Lead not found', status: 404 }
  if (String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', status: 403 }
  }
  return { ok: true }
}

exports.getChatStatus = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertStaffLeadAccess(leadId, req.user)
  if (access.error) {
    return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }

  const status = await chatLifecycle.getChatStatusByLeadId(leadId)
  if (!status) return notFound(res, 'Lead not found')

  return success(res, status)
})

exports.endChat = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertStaffLeadAccess(leadId, req.user)
  if (access.error) {
    return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }

  const result = await chatLifecycle.endChat(leadId, req.user._id)
  if (result.error) return notFound(res, result.error)

  return success(res, result.status, 'Chat ended')
})

exports.reopenChat = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertStaffLeadAccess(leadId, req.user)
  if (access.error) {
    return access.status === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }

  const result = await chatLifecycle.reopenChat(leadId, req.user._id)
  if (result.error) return notFound(res, result.error)

  return success(res, result.status, 'Chat reopened')
})
