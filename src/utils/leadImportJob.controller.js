const { success, notFound } = require('./apiResponse')
const asyncHandler = require('./asyncHandler')
const {
  getLeadImportJob,
  formatJobPayload,
} = require('../services/leadImportJob.service')

exports.getLeadImportJobStatus = (salesResponseShape = false) =>
  asyncHandler(async (req, res) => {
    const job = await getLeadImportJob(req.params.jobId, req.user._id)
    if (!job) return notFound(res, 'Import job not found')

    const payload = formatJobPayload(job, { salesResponseShape })
    if (job.status === 'completed') {
      return success(res, payload, 'Import complete')
    }
    if (job.status === 'failed') {
      return success(res, payload, job.errorMessage || 'Import failed')
    }
    return success(res, payload, 'Import in progress')
  })
