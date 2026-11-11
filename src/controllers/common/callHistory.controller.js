const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const Lead = require('../../models/Lead')
const voiceCall = require('../../services/twilio/voiceCall.service')
const CallSession = require('../../models/CallSession')

const assertLeadAccess = async (req, leadId) => {
  const lead = await Lead.findById(leadId).select('_id assignedSales').lean()
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (req.user.role === 'sales' && String(lead.assignedSales || '') !== String(req.user._id)) {
    return { error: 'This lead is not assigned to you', code: 403 }
  }
  return { lead }
}

exports.listLeadCalls = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertLeadAccess(req, leadId)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const data = await voiceCall.listCallsForLead(leadId, {
    page: req.query.page,
    limit: req.query.limit,
  })
  return success(res, data)
})

exports.getCallDetail = asyncHandler(async (req, res) => {
  const { callSessionId } = req.params
  const detail = await voiceCall.getCallDetail(callSessionId)
  if (!detail) return notFound(res, 'Call session not found')

  if (detail.call.leadId) {
    const access = await assertLeadAccess(req, detail.call.leadId)
    if (access.error) {
      if (access.code === 404) return notFound(res, access.error)
      return forbidden(res, access.error)
    }
  } else if (req.user.role === 'sales') {
    return forbidden(res, 'Call is outside your scope')
  }

  return success(res, detail)
})

exports.getCallDetailBySid = asyncHandler(async (req, res) => {
  const sid = req.params.twilioCallSid
  if (!sid) return badRequest(res, 'twilioCallSid is required')
  const session = await CallSession.findOne({ twilioCallSid: sid }).select('_id').lean()
  if (!session) return notFound(res, 'Call session not found')
  req.params.callSessionId = String(session._id)
  return exports.getCallDetail(req, res)
})
