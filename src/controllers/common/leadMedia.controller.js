const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { getScopedLeadIds } = require('../../utils/plantAccessScope')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')
const {
  MEDIA_DOCUMENT_TYPES,
  isMediaType,
  pickMediaDocuments,
  buildLeadMediaPayload,
} = require('../../services/leadMedia.service')

const assertLeadMediaAccess = async (req, res, lead) => {
  const role = req.user?.role
  if (role === 'admin' || role === 'construction') return true
  if (role === 'sales') {
    if (String(lead.assignedSales) !== String(req.user._id)) {
      forbidden(res, 'Access denied')
      return false
    }
    return true
  }
  if (role === 'plant') {
    const scoped = await getScopedLeadIds(req)
    if (!scoped.some((id) => String(id) === String(lead._id))) {
      forbidden(res, 'Access denied')
      return false
    }
    return true
  }
  forbidden(res, 'Access denied')
  return false
}

/** GET — one lead’s photos & videos (?type=photo|video optional) */
exports.getLeadMedia = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { type } = req.query
  if (type && !isMediaType(type)) {
    return badRequest(res, `type must be one of: ${MEDIA_DOCUMENT_TYPES.join(', ')}`)
  }

  const lead = await Lead.findById(leadId)
    .select('jobId projectName documents assignedSales')
    .lean()
  if (!lead) return notFound(res, 'Lead not found')

  const ok = await assertLeadMediaAccess(req, res, lead)
  if (!ok) return

  const payload = await buildLeadMediaPayload(lead, type)
  return success(res, payload)
})

/**
 * GET — projects that have photos/videos.
 * Query: type, leadId, search, page, limit
 */
exports.listMediaProjects = asyncHandler(async (req, res) => {
  const { type, leadId, search, page = 1, limit = 20 } = req.query
  if (type && !isMediaType(type)) {
    return badRequest(res, `type must be one of: ${MEDIA_DOCUMENT_TYPES.join(', ')}`)
  }

  const filter = { isTerminated: { $ne: true } }
  if (search?.trim()) {
    filter.$or = [
      { projectName: { $regex: search.trim(), $options: 'i' } },
      { jobId: { $regex: search.trim(), $options: 'i' } },
    ]
  }

  if (req.user?.role === 'plant') {
    const scoped = await getScopedLeadIds(req)
    if (leadId) {
      if (!scoped.some((id) => String(id) === String(leadId))) {
        return success(res, { projects: [], total: 0 })
      }
      filter._id = leadId
    } else {
      filter._id = { $in: scoped }
    }
  } else if (leadId) {
    filter._id = leadId
  }

  if (req.user?.role === 'sales') {
    filter.assignedSales = req.user._id
  }

  const leads = await Lead.find(filter)
    .select('projectName jobId location documents customerId updatedAt')
    .populate('customerId', 'firstName lastName')
    .lean()

  const result = []
  for (const lead of leads) {
    const docs = pickMediaDocuments(lead.documents, type)
    if (!docs.length) continue
    const photos = docs.filter((d) => d.type === 'photo')
    const videos = docs.filter((d) => d.type === 'video')
    result.push({
      leadId: lead._id,
      projectId: lead.jobId,
      projectName: lead.projectName,
      location: lead.location,
      lastUpdate: lead.updatedAt,
      documents: docs,
      photos,
      videos,
      photoCount: photos.length,
      videoCount: videos.length,
    })
  }

  const start = (Number(page) - 1) * Number(limit)
  const paginated = result.slice(start, start + Number(limit))

  return success(res, { projects: paginated, total: result.length })
})

/** POST — attach photo or video after S3 upload. Body: { url, name, type: photo|video } */
exports.uploadLeadMedia = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { url, name, type } = req.body
  if (!url || !name) return badRequest(res, 'url and name are required')
  if (!isMediaType(type)) {
    return badRequest(res, `type must be one of: ${MEDIA_DOCUMENT_TYPES.join(', ')}`)
  }

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')

  const ok = await assertLeadMediaAccess(req, res, lead)
  if (!ok) return

  lead.documents.push({
    url,
    name,
    type,
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.DOCUMENT_ADDED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { name, url, documentType: type },
  })

  const document = lead.documents[lead.documents.length - 1]
  return success(res, { document }, `${type} uploaded`)
})
