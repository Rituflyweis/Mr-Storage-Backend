const POOrder = require('../../models/POOrder')
const crypto = require('crypto')
const ShipperRequest = require('../../models/ShipperRequest')
const ShipperComparisonJob = require('../../models/ShipperComparisonJob')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const QuoteComparisonResult = require('../../models/QuoteComparisonResult')
const VendorQuoteLine = require('../../models/VendorQuoteLine')
const BOMItem = require('../../models/BOMItem')
const BundlePlan = require('../../models/BundlePlan')
const PackingListPlan = require('../../models/PackingListPlan')
const Bundle = require('../../models/Bundle')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const {
  mapProjectNameFallbackFields,
  LEAD_PROJECT_LIST_SELECT,
  LEAD_PROJECT_LIST_POPULATE,
} = require('../../utils/plantProjectListFields')
const { processShipperComparisonJob } = require('../../services/plant/shipperComparison.service')
const {
  BUNDLE_PLANNING_SERVICE_VERSION,
  generateBundlesFromVendorLinesWithBomWeights,
} = require('../../services/plant/loadPlanning.service')
const {
  sendShipperApprovalEmail,
  sendShipperRejectionEmail,
  sendShipperResubmitRequestEmail,
} = require('../../services/email/mailer')
const auditService = require('../../services/audit.service')
const {
  buildVendorUploadPageUrl,
  getComparisonBlockers,
  buildVendorExceptionSummary,
  buildAutoResubmitNote,
  RESUBMIT_ALLOWED_STATUSES,
} = require('../../utils/vendorUpload.util')
const {
  COMPARISON_RESULT_CATEGORIES,
  getStatusesForCategory,
  mapComparisonResultRow,
  aggregateComparisonStats,
} = require('../../utils/shipperComparisonCategories')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { SHIPPER_REQUEST_LATEST_FIRST_SORT, sortShipperRequestsByLowestBid } = require('../../utils/shipperRequestSort')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const getAssignedLeadIds = async (plantUserId) =>
  POOrder.distinct('leadId', { assignedTo: plantUserId, status: 'approved' })

const resolveFileReceivedStatus = (total, received) => {
  if (!total || total <= 0) return 'none'
  if (received <= 0) return 'none'
  if (received >= total) return 'all'
  return 'partial'
}

const getNextBundlePlanNumber = async () => {
  const latest = await BundlePlan.findOne({
    planNumber: { $regex: /^BP-\d+$/ },
  }).sort({ createdAt: -1 }).select('planNumber').lean()

  const current = latest?.planNumber ? Number(String(latest.planNumber).replace('BP-', '')) : 0
  const next = Number.isFinite(current) ? current + 1 : 1
  return `BP-${String(next).padStart(4, '0')}`
}

exports.getShipperProjects = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req.user._id)
  if (!leadIds.length) return success(res, { projects: [], total: 0 })

  const requests = await ShipperRequest.find({ leadId: { $in: leadIds } })
    .populate({
      path: 'leadId',
      select: LEAD_PROJECT_LIST_SELECT,
      populate: LEAD_PROJECT_LIST_POPULATE,
    })
    .sort(SHIPPER_REQUEST_LATEST_FIRST_SORT)
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
        ...mapProjectNameFallbackFields(lead),
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

exports.getShipperFilesStats = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req.user._id)
  if (!leadIds.length) {
    return success(res, {
      totalFiles: 0,
      filesReceived: 0,
      ordersSent: 0,
      revisionsSent: 0,
    })
  }

  const requests = await ShipperRequest.find({ leadId: { $in: leadIds } })
    .select('status submittedFileUrl sentAt resubmitCount')
    .lean()

  const ordersSentStatuses = new Set([
    'sent',
    'submitted',
    'comparison_processing',
    'comparison_completed',
    'comparison_failed',
    'approved',
    'rejected',
    'resubmit_requested',
  ])

  const totalFiles = requests.length
  const filesReceived = requests.filter((row) => Boolean(row.submittedFileUrl)).length
  const ordersSent = requests.filter((row) => {
    return Boolean(row.sentAt) && ordersSentStatuses.has(row.status)
  }).length
  const revisionsSent = requests.reduce((sum, row) => sum + Number(row.resubmitCount || 0), 0)

  return success(res, {
    totalFiles,
    filesReceived,
    ordersSent,
    revisionsSent,
  })
})

exports.getProjectShipperRequests = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertPlantProjectAccess(leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const requests = sortShipperRequestsByLowestBid(
    await ShipperRequest.find({ leadId })
      .populate('vendorId', 'vendorName vendorCode')
      .lean()
  )

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
      comparisonStatus: r.comparisonStatus || 'idle',
      resubmitCount: r.resubmitCount || 0,
      resubmitRequestedAt: r.resubmitRequestedAt || null,
      canRequestResubmit: ['submitted', 'comparison_completed', 'comparison_failed', 'resubmit_requested'].includes(r.status),
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

exports.approveShipperRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const selected = await ShipperRequest.findById(requestId)
    .populate('vendorId', 'vendorName email')
    .populate('leadId', 'projectName jobId customerId')
  if (!selected) return notFound(res, 'Shipper request not found')

  const access = await assertPlantProjectAccess(selected.leadId._id, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const siblings = await ShipperRequest.find({
    leadId: selected.leadId._id,
    consolidatedBOMId: selected.consolidatedBOMId,
  }).populate('vendorId', 'vendorName email')

  const alreadyApproved = siblings.find((r) => r.status === 'approved' && String(r._id) !== String(selected._id))
  if (alreadyApproved) {
    return badRequest(res, 'Another vendor is already approved for this consolidated BOM')
  }

  selected.status = 'approved'
  selected.reviewedBy = req.user._id
  selected.reviewedAt = new Date()
  await selected.save()

  const rejectedRequests = []
  for (const reqDoc of siblings) {
    if (String(reqDoc._id) === String(selected._id)) continue
    if (reqDoc.status !== 'approved') {
      reqDoc.status = 'rejected'
      reqDoc.reviewedBy = req.user._id
      reqDoc.reviewedAt = new Date()
      reqDoc.manualReviewNote = 'Another vendor was selected for this project.'
      await reqDoc.save()
    }
    rejectedRequests.push(reqDoc)
  }

  await ConsolidatedBOM.findByIdAndUpdate(selected.consolidatedBOMId, { status: 'approved' })

  const emailFailures = []
  try {
    if (selected.vendorId?.email) {
      await sendShipperApprovalEmail({
        toEmail: selected.vendorId.email,
        vendorName: selected.vendorId.vendorName,
        projectName: selected.leadId.projectName,
        jobId: selected.leadId.jobId,
      })
    }
  } catch (err) {
    emailFailures.push({ vendorId: selected.vendorId?._id, type: 'approved', error: err.message })
  }

  for (const reqDoc of rejectedRequests) {
    try {
      if (reqDoc.vendorId?.email) {
        await sendShipperRejectionEmail({
          toEmail: reqDoc.vendorId.email,
          vendorName: reqDoc.vendorId.vendorName,
          projectName: selected.leadId.projectName,
          jobId: selected.leadId.jobId,
        })
      }
    } catch (err) {
      emailFailures.push({ vendorId: reqDoc.vendorId?._id, type: 'rejected', error: err.message })
    }
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.SHIPPER_REQUEST_APPROVED,
    leadId: selected.leadId._id,
    customerId: selected.leadId.customerId,
    performedBy: req.user._id,
    metadata: {
      shipperRequestId: selected._id,
      approvedVendorId: selected.vendorId?._id || selected.vendorId,
      rejectedVendorIds: rejectedRequests.map((r) => r.vendorId?._id || r.vendorId),
      consolidatedBOMId: selected.consolidatedBOMId,
    },
  })

  for (const rejected of rejectedRequests) {
    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.SHIPPER_REQUEST_REJECTED,
      leadId: selected.leadId._id,
      customerId: selected.leadId.customerId,
      performedBy: req.user._id,
      metadata: {
        shipperRequestId: rejected._id,
        vendorId: rejected.vendorId?._id || rejected.vendorId,
        reason: 'Another vendor was selected for this project.',
      },
    })
  }

  return success(res, {
    requestId: selected._id,
    status: selected.status,
    reviewedAt: selected.reviewedAt,
    approvedVendor: {
      vendorId: selected.vendorId?._id || selected.vendorId,
      vendorName: selected.vendorId?.vendorName || '',
    },
    rejectedRequests: rejectedRequests.map((r) => ({
      requestId: r._id,
      vendorId: r.vendorId?._id || r.vendorId,
      vendorName: r.vendorId?.vendorName || '',
      status: r.status,
    })),
    emailFailures,
  }, 'Vendor selection finalized')
})

exports.requestShipperResubmit = asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const { note, includeComparisonExceptions = true } = req.body
  const request = await ShipperRequest.findById(requestId)
    .populate('vendorId', 'vendorName email')
    .populate('leadId', 'projectName jobId customerId')

  if (!request) return notFound(res, 'Shipper request not found')

  const access = await assertPlantProjectAccess(request.leadId._id, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (request.status === 'approved' || request.status === 'rejected') {
    return badRequest(res, 'Cannot request resubmit for an approved or rejected vendor request')
  }

  if (request.status === 'comparison_processing') {
    return badRequest(res, 'Comparison is still running. Wait for completion before requesting resubmit.')
  }

  if (!RESUBMIT_ALLOWED_STATUSES.has(request.status)) {
    return badRequest(res, `Cannot request resubmit while status is ${request.status}`)
  }

  const exceptionSummary = includeComparisonExceptions
    ? buildVendorExceptionSummary(request)
    : null

  const trimmedNote = String(note || '').trim()
  const resubmitNote = trimmedNote || (exceptionSummary ? buildAutoResubmitNote(exceptionSummary) : '')
  if (!resubmitNote) {
    return badRequest(res, 'note is required when comparison exceptions are not included')
  }

  const priorToken = request.token
  const vendorExceptionSummary = exceptionSummary || {
    priorQuoteValue: request.quoteValue ?? null,
    priorSubmittedFileName: request.submittedFileName || '',
    priorSubmittedAt: request.submittedAt || null,
  }

  if (request.submittedFileUrl || request.submittedAt) {
    request.submissionHistory.push({
      submittedFileUrl: request.submittedFileUrl || null,
      submittedFileName: request.submittedFileName || '',
      quoteValue: request.quoteValue ?? null,
      submittedAt: request.submittedAt || null,
      token: priorToken,
      comparisonSummary: request.comparisonSummary || null,
      exceptionsCount: Array.isArray(request.exceptions) ? request.exceptions.length : 0,
    })
  }

  request.token = crypto.randomBytes(32).toString('hex')
  request.tokenExpiresAt = null
  request.status = 'resubmit_requested'
  request.manualReviewNote = resubmitNote
  request.vendorExceptionSummary = vendorExceptionSummary
  request.reviewedBy = req.user._id
  request.reviewedAt = new Date()
  request.resubmitRequestedAt = new Date()
  request.resubmitCount = (request.resubmitCount || 0) + 1
  request.submittedFileUrl = null
  request.submittedFileName = ''
  request.submittedAt = null
  request.quoteValue = null
  request.comparisonStatus = 'idle'
  request.comparisonSummary = null
  request.comparisonError = null
  request.comparisonRanAt = null
  request.exceptions = []
  await request.save()

  await QuoteComparisonResult.deleteMany({ shipperRequestId: request._id })
  await VendorQuoteLine.deleteMany({ shipperRequestId: request._id })

  const uploadUrl = buildVendorUploadPageUrl(request.token)
  const emailFailures = []
  try {
    if (request.vendorId?.email) {
      await sendShipperResubmitRequestEmail({
        toEmail: request.vendorId.email,
        vendorName: request.vendorId.vendorName,
        projectName: request.leadId.projectName,
        jobId: request.leadId.jobId,
        note: request.manualReviewNote,
        uploadUrl,
        exceptionSummary: vendorExceptionSummary,
      })
    }
  } catch (err) {
    emailFailures.push({ vendorId: request.vendorId?._id, error: err.message })
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.SHIPPER_RESUBMIT_REQUESTED,
    leadId: request.leadId._id,
    customerId: request.leadId.customerId,
    performedBy: req.user._id,
    metadata: {
      shipperRequestId: request._id,
      vendorId: request.vendorId?._id || request.vendorId,
      note: request.manualReviewNote,
      priorToken,
      newToken: request.token,
      resubmitCount: request.resubmitCount,
      exceptionCount: vendorExceptionSummary?.exceptionCount ?? 0,
      blockers: vendorExceptionSummary?.blockers || [],
    },
  })

  return success(res, {
    requestId: request._id,
    status: request.status,
    reviewedAt: request.reviewedAt,
    resubmitCount: request.resubmitCount,
    uploadUrl,
    priorToken,
    token: request.token,
    note: request.manualReviewNote,
    exceptionSummary: vendorExceptionSummary,
    emailFailures,
  }, 'Resubmit requested with new upload link')
})

exports.getShipperComparisonSummary = asyncHandler(async (req, res) => {
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

  const summary = request.comparisonSummary || null
  const blockers = getComparisonBlockers(summary)
  const canProceedToApproval = request.comparisonStatus === 'completed' && blockers.length === 0

  const [stats, results] = await Promise.all([
    aggregateComparisonStats(QuoteComparisonResult, request._id),
    QuoteComparisonResult.find({ shipperRequestId: request._id })
      .sort({ createdAt: -1 })
      .lean(),
  ])

  return success(res, {
    requestId: request._id,
    leadId: request.leadId?._id || request.leadId,
    projectId: request.leadId?.jobId || '',
    projectName: request.leadId?.projectName || '',
    vendorId: request.vendorId?._id || request.vendorId,
    vendorName: request.vendorId?.vendorName || '',
    vendorCode: request.vendorId?.vendorCode || '',
    status: request.status,
    comparisonStatus: request.comparisonStatus,
    comparisonRanAt: request.comparisonRanAt,
    comparisonError: request.comparisonError,
    summary,
    stats,
    exceptionsCount: Array.isArray(request.exceptions) ? request.exceptions.length : 0,
    resultCount: results.length,
    results: results.map(mapComparisonResultRow),
    canProceedToApproval,
    blockers,
    resubmitAvailable: RESUBMIT_ALLOWED_STATUSES.has(request.status),
    resubmitCount: request.resubmitCount || 0,
    resubmitRequestedAt: request.resubmitRequestedAt || null,
    vendorExceptionSummary: request.vendorExceptionSummary || null,
  })
})

exports.getShipperComparisonResults = asyncHandler(async (req, res) => {
  const { requestId } = req.params
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20))
  const status = req.query.status ? String(req.query.status).trim() : null
  const severity = req.query.severity ? String(req.query.severity).trim() : null
  const category = req.query.category ? String(req.query.category).trim().toLowerCase() : 'all'

  if (status && category && category !== 'all') {
    return badRequest(res, 'Use either category or status filter, not both')
  }

  if (category && category !== 'all' && !COMPARISON_RESULT_CATEGORIES.includes(category)) {
    return badRequest(res, `Invalid category. Use: ${COMPARISON_RESULT_CATEGORIES.join(', ')}`)
  }

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

  const filter = { shipperRequestId: request._id }
  if (severity) filter.severity = severity

  if (status) {
    filter.status = status
  } else if (category && category !== 'all') {
    const statuses = getStatusesForCategory(category)
    if (!statuses) {
      return badRequest(res, `Invalid category. Use: ${COMPARISON_RESULT_CATEGORIES.join(', ')}`)
    }
    filter.status = { $in: statuses }
  }

  const [total, rows] = await Promise.all([
    QuoteComparisonResult.countDocuments(filter),
    QuoteComparisonResult.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ])

  return success(res, {
    requestId: request._id,
    leadId: request.leadId?._id || request.leadId,
    projectId: request.leadId?.jobId || '',
    projectName: request.leadId?.projectName || '',
    vendorId: request.vendorId?._id || request.vendorId,
    vendorName: request.vendorId?.vendorName || '',
    vendorCode: request.vendorId?.vendorCode || '',
    status: request.status,
    comparisonStatus: request.comparisonStatus,
    category: category || 'all',
    filters: { status, severity, category: category || 'all' },
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 0,
    },
    results: rows.map(mapComparisonResultRow),
  })
})

exports.generateBundlePlan = asyncHandler(async (req, res) => {
  const { requestId } = req.params

  const request = await ShipperRequest.findById(requestId)
    .populate('leadId', 'projectName customerId')
    .lean()

  if (!request) {
    return notFound(res, 'Shipper request not found')
  }

  const leadId = request.leadId?._id || request.leadId

  const access = await assertPlantProjectAccess(leadId, req.user._id)

  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  if (request.status !== 'approved') {
    return badRequest(
      res,
      'Bundle plan can be generated only for approved shipper request'
    )
  }

  const existingPlan = await BundlePlan.findOne({
    shipperRequestId: request._id,
  })
    .select('_id status planNumber')
    .lean()

  if (existingPlan?.status === 'confirmed') {
    return badRequest(
      res,
      'Confirmed bundle plan already exists for this shipper request'
    )
  }

  /**
   * Critical:
   * Do not delete/regenerate bundles if packing list planning already exists.
   * Otherwise PackingList.bundleIds will point to deleted Bundle documents.
   */
  if (existingPlan) {
    const existingPackingListPlan = await PackingListPlan.findOne({
      bundlePlanId: existingPlan._id,
      status: { $ne: 'cancelled' },
    })
      .select('_id status')
      .lean()

    if (existingPackingListPlan) {
      return badRequest(
        res,
        'Cannot regenerate bundle plan because packing list/truck plan already exists. Cancel or reset packing list plan first.',
        {
          packingListPlanId: existingPackingListPlan._id,
          packingListPlanStatus: existingPackingListPlan.status,
        }
      )
    }
  }

  const vendorLines = await VendorQuoteLine.find({
    shipperRequestId: request._id,
    $or: [
      { qty: { $gt: 0 } },
      { pieceQty: { $gt: 0 } },
    ],
  })
    .sort({
      extractionFormat: 1,
      pageNumber: 1,
      rowNumber: 1,
      pieceMarkNormalized: 1,
    })
    .lean()

  if (!vendorLines.length) {
    return badRequest(res, 'No valid vendor quote lines found for this shipper request')
  }

  const generatedBundles = await generateBundlesFromVendorLinesWithBomWeights(vendorLines, {
    shipperRequestId: request._id,
  })

  const missingWeightItemCount = generatedBundles.reduce((sum, bundle) => {
    return sum + (bundle.items || []).filter((item) => {
      return item.sourceLineSnapshot?.weightMissing === true || Number(item.weight || 0) <= 0
    }).length
  }, 0)

  if (!generatedBundles.length) {
    return badRequest(res, 'No bundles could be generated from vendor lines')
  }

  const planNumber = existingPlan?.planNumber || await getNextBundlePlanNumber()

  const totalWeight = generatedBundles.reduce(
    (sum, bundle) => sum + Number(bundle.totalWeight || 0),
    0
  )

  const maxLengthFeet = generatedBundles.reduce(
    (max, bundle) => Math.max(max, Number(bundle.maxLengthFeet || 0)),
    0
  )

  const warnings = [
    ...new Set([
      ...generatedBundles.flatMap((bundle) => bundle.warnings || []),

      ...(missingWeightItemCount
        ? [
            `${missingWeightItemCount} bundle item(s) have missing/zero weight after BOM matching. Bundle weight and truck planning may be inaccurate.`,
          ]
        : []),

      ...(totalWeight <= 0
        ? [
            'Total bundle plan weight is zero/missing. Truck/load planning must be manually reviewed.',
          ]
        : []),
    ]),
  ]

  if (totalWeight <= 0) {
    return badRequest(res, 'Bundle plan generation failed: BOM matched weight was not applied, so generated total weight is zero. Nothing was saved.', {
      serviceVersion: BUNDLE_PLANNING_SERVICE_VERSION,
      shipperRequestId: request._id,
      vendorLineCount: vendorLines.length,
      generatedBundleCount: generatedBundles.length,
      missingWeightItemCount,
      hint: 'Check QuoteComparisonResult matched rows and BOMItem.weight for this shipperRequestId. The controller must call generateBundlesFromVendorLinesWithBomWeights.',
    })
  }

  if (missingWeightItemCount >= vendorLines.length) {
    return badRequest(res, 'Bundle plan generation failed: all vendor lines still have zero/missing weight after BOM matching. Nothing was saved.', {
      serviceVersion: BUNDLE_PLANNING_SERVICE_VERSION,
      shipperRequestId: request._id,
      vendorLineCount: vendorLines.length,
      generatedBundleCount: generatedBundles.length,
      totalWeight,
      missingWeightItemCount,
    })
  }

  let bundlePlan
  const wasRegenerated = Boolean(existingPlan)

  if (existingPlan) {
    bundlePlan = await BundlePlan.findByIdAndUpdate(
      existingPlan._id,
      {
        leadId,
        shipperRequestId: request._id,
        vendorId: request.vendorId,
        planNumber,
        status: 'generated',

        totalSourceItems: vendorLines.length,
        totalBundles: generatedBundles.length,
        totalWeight,
        maxLengthFeet,
        warnings,

        generatedBy: req.user._id,
        confirmedBy: null,
        confirmedAt: null,
      },
      {
        new: true,
        runValidators: true,
      }
    )

    await Bundle.deleteMany({
      bundlePlanId: bundlePlan._id,
    })
  } else {
    bundlePlan = await BundlePlan.create({
      leadId,
      shipperRequestId: request._id,
      vendorId: request.vendorId,
      planNumber,
      status: 'generated',

      totalSourceItems: vendorLines.length,
      totalBundles: generatedBundles.length,
      totalWeight,
      maxLengthFeet,
      warnings,

      generatedBy: req.user._id,
    })
  }

  const bundlesToInsert = generatedBundles.map((bundle) => ({
    ...bundle,
    bundlePlanId: bundlePlan._id,
    leadId,
    shipperRequestId: request._id,
  }))

  const bundles = await Bundle.insertMany(bundlesToInsert)

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.BUNDLE_PLAN_GENERATED,
    leadId,
    customerId: request.leadId?.customerId || null,
    performedBy: req.user._id,
    metadata: {
      shipperRequestId: request._id,
      bundlePlanId: bundlePlan._id,
      totalSourceItems: vendorLines.length,
      totalBundles: bundles.length,
      totalWeight,
      maxLengthFeet,
      missingWeightItemCount: missingWeightItemCount,
      regenerated: wasRegenerated,
    },
  })

  const responseData = {
    bundlePlan: {
      _id: bundlePlan._id,
      planNumber: bundlePlan.planNumber,
      status: bundlePlan.status,

      totalSourceItems: bundlePlan.totalSourceItems,
      totalBundles: bundlePlan.totalBundles,
      totalWeight: bundlePlan.totalWeight,
      maxLengthFeet: bundlePlan.maxLengthFeet,

      missingWeightItemCount: missingWeightItemCount,
      hasWeightWarning: missingWeightItemCount > 0 || totalWeight <= 0,

      warnings: bundlePlan.warnings || [],
    },

    bundles: bundles.map((bundle) => ({
      _id: bundle._id,
      bundleNo: bundle.bundleNo,
      bundleType: bundle.bundleType,
      title: bundle.title,

      totalQty: bundle.totalQty,
      totalWeight: bundle.totalWeight,
      maxLengthFeet: bundle.maxLengthFeet,

      itemCount: bundle.items?.length || 0,

      missingWeightItemCount: (bundle.items || []).filter((item) => {
        return item.sourceLineSnapshot?.weightMissing === true
      }).length,

      stacking: {
        stackLevel: bundle.stacking?.stackLevel,
        canStackOnTop: bundle.stacking?.canStackOnTop,
        canHaveItemsStackedOnIt: bundle.stacking?.canHaveItemsStackedOnIt,
        isFragile: bundle.stacking?.isFragile,
        mustStayFlat: bundle.stacking?.mustStayFlat,
        keepDry: bundle.stacking?.keepDry,
        requiresEdgeProtection: bundle.stacking?.requiresEdgeProtection,
        loadingPriority: bundle.stacking?.loadingPriority,
        unloadingPriority: bundle.stacking?.unloadingPriority,
      },

      loadSequence: bundle.loadSequence,
      handlingInstruction: bundle.handlingInstruction || '',

      warnings: bundle.warnings || [],
      notes: bundle.notes || '',
    })),
  }

  if (wasRegenerated) {
    return success(res, responseData, 'Bundle plan regenerated')
  }

  return created(res, responseData, 'Bundle plan generated')
})