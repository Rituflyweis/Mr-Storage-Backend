const POOrder = require('../../models/POOrder')
const ShipperRequest = require('../../models/ShipperRequest')
const ShipperComparisonJob = require('../../models/ShipperComparisonJob')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { processShipperComparisonJob } = require('../../services/plant/shipperComparison.service')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const getAssignedLeadIds = async (plantUserId) =>
  POOrder.distinct('leadId', { assignedTo: plantUserId, status: 'approved' })

const resolveFileReceivedStatus = (total, received) => {
  if (!total || total <= 0) return 'none'
  if (received <= 0) return 'none'
  if (received >= total) return 'all'
  return 'partial'
}

exports.getShipperProjects = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req.user._id)
  if (!leadIds.length) return success(res, { projects: [], total: 0 })

  const requests = await ShipperRequest.find({ leadId: { $in: leadIds } })
    .populate('leadId', 'projectName jobId')
    .sort({ createdAt: -1 })
    .lean()

  const projectMap = new Map()

  for (const request of requests) {
    const lead = request.leadId
    if (!lead?._id) continue
    const key = String(lead._id)

    if (!projectMap.has(key)) {
      projectMap.set(key, {
        leadId: lead._id,
        projectId: lead.jobId || '',
        jobId: lead.jobId || '',
        projectName: lead.projectName || '',
        totalShipperFiles: 0,
        receivedShipperFiles: 0,
        fileReceivedStatus: 'none',
        latestSubmittedAt: null,
      })
    }

    const row = projectMap.get(key)
    row.totalShipperFiles += 1
    if (request.submittedFileUrl) {
      row.receivedShipperFiles += 1
      if (!row.latestSubmittedAt || new Date(request.submittedAt || 0) > new Date(row.latestSubmittedAt)) {
        row.latestSubmittedAt = request.submittedAt || null
      }
    }
    row.fileReceivedStatus = resolveFileReceivedStatus(row.totalShipperFiles, row.receivedShipperFiles)
  }

  const projects = [...projectMap.values()].sort((a, b) => {
    const aTime = a.latestSubmittedAt ? new Date(a.latestSubmittedAt).getTime() : 0
    const bTime = b.latestSubmittedAt ? new Date(b.latestSubmittedAt).getTime() : 0
    return bTime - aTime
  })

  return success(res, { projects, total: projects.length })
})

exports.getProjectShipperRequests = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertPlantProjectAccess(leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const requests = await ShipperRequest.find({ leadId })
    .populate('vendorId', 'vendorName vendorCode')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, {
    leadId,
    projectId: access.lead.jobId || '',
    projectName: access.lead.projectName || '',
    shipperRequests: requests.map((r) => ({
      requestId: r._id,
      vendorId: r.vendorId?._id || r.vendorId,
      vendorName: r.vendorId?.vendorName || '',
      vendorCode: r.vendorId?.vendorCode || '',
      fileName: r.submittedFileName || '',
      uploadedDate: r.submittedAt || null,
      rates: r.quoteValue ?? null,
      fileStatus: r.status,
    })),
    total: requests.length,
  })
})

exports.getShipperRequestDocument = asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const request = await ShipperRequest.findById(requestId)
    .populate('vendorId', 'vendorName vendorCode')
    .populate('leadId', 'projectName jobId')
    .lean()

  if (!request) return notFound(res, 'Shipper request not found')

  const access = await assertPlantProjectAccess(request.leadId?._id || request.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  return success(res, {
    requestId: request._id,
    leadId: request.leadId?._id || request.leadId,
    projectId: request.leadId?.jobId || '',
    projectName: request.leadId?.projectName || '',
    vendorId: request.vendorId?._id || request.vendorId,
    vendorName: request.vendorId?.vendorName || '',
    vendorCode: request.vendorId?.vendorCode || '',
    fileName: request.submittedFileName || '',
    fileUrl: request.submittedFileUrl || null,
    uploadedDate: request.submittedAt || null,
    rates: request.quoteValue ?? null,
    fileStatus: request.status,
  })
})

exports.compareShipperRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const request = await ShipperRequest.findById(requestId).select('leadId vendorId submittedFileUrl')
  if (!request) return notFound(res, 'Shipper request not found')

  const access = await assertPlantProjectAccess(request.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (!request.submittedFileUrl) {
    return badRequest(res, 'Vendor has not submitted a file yet')
  }

  const runningJob = await ShipperComparisonJob.findOne({
    shipperRequestId: requestId,
    status: { $in: ['queued', 'processing'] },
  }).sort({ createdAt: -1 }).lean()

  if (runningJob) {
    return success(res, {
      requestId,
      compareJobId: runningJob._id,
      status: runningJob.status,
      message: 'Comparison already in progress',
    })
  }

  const job = await ShipperComparisonJob.create({
    shipperRequestId: request._id,
    leadId: request.leadId,
    vendorId: request.vendorId,
    triggeredBy: req.user._id,
    status: 'queued',
  })

  processShipperComparisonJob(job._id).catch((err) => {
    console.error('[ShipperCompareJob] Background processing error:', err.message)
  })

  return success(res, {
    requestId,
    compareJobId: job._id,
    status: job.status,
    message: 'Comparison started. Poll compare job status until completed.',
  }, 'Comparison job queued')
})

exports.getComparisonJobStatus = asyncHandler(async (req, res) => {
  const { jobId } = req.params
  const job = await ShipperComparisonJob.findById(jobId).lean()
  if (!job) return notFound(res, 'Comparison job not found')

  const access = await assertPlantProjectAccess(job.leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  return success(res, {
    compareJobId: job._id,
    requestId: job.shipperRequestId,
    leadId: job.leadId,
    vendorId: job.vendorId,
    status: job.status,
    summary: job.summary,
    resultCount: job.resultCount ?? 0,
    errorMessage: job.errorMessage,
    processingStartedAt: job.processingStartedAt,
    processingEndedAt: job.processingEndedAt,
  })
})

exports.getComparisonJobsStatusBatch = asyncHandler(async (req, res) => {
  const { jobIds } = req.body
  if (!Array.isArray(jobIds) || !jobIds.length) {
    return badRequest(res, 'jobIds array is required')
  }

  const jobs = await ShipperComparisonJob.find({ _id: { $in: jobIds } }).lean()
  const rows = []

  for (const jobId of jobIds) {
    const job = jobs.find((j) => String(j._id) === String(jobId))
    if (!job) {
      rows.push({ compareJobId: jobId, error: 'Not found' })
      continue
    }

    const access = await assertPlantProjectAccess(job.leadId, req.user._id)
    if (access.error) {
      rows.push({ compareJobId: jobId, error: access.error })
      continue
    }

    rows.push({
      compareJobId: job._id,
      requestId: job.shipperRequestId,
      status: job.status,
      resultCount: job.resultCount ?? 0,
      errorMessage: job.errorMessage,
      processingEndedAt: job.processingEndedAt,
    })
  }

  return success(res, { jobs: rows })
})
