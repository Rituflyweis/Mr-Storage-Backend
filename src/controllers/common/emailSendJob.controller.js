const EmailSendJob = require('../../models/EmailSendJob')
const Lead = require('../../models/Lead')
const { success, notFound, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

exports.getEmailSendJobStatus = asyncHandler(async (req, res) => {
  const job = await EmailSendJob.findById(req.params.jobId).lean()
  if (!job) return notFound(res, 'Email send job not found')

  const { error: accessError, code } = await checkLeadAccess(job.leadId, req.user)
  if (accessError) {
    return code === 404 ? notFound(res, accessError) : forbidden(res, accessError)
  }

  return success(res, {
    emailSendJobId: job._id,
    type: job.type,
    resourceId: job.resourceId,
    leadId: job.leadId,
    status: job.status,
    result: job.result || null,
    errorMessage: job.errorMessage || null,
    processingStartedAt: job.processingStartedAt,
    processingEndedAt: job.processingEndedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  })
})
