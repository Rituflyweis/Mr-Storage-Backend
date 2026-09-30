const Lead = require('../../models/Lead')
const User = require('../../models/User')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { PLANT_LIFECYCLE_STAGES } = require('../../config/constants')
const { getMergedDrawings } = require('../../utils/drawingSources')

const CONSTRUCTION_STAGES = [...PLANT_LIFECYCLE_STAGES]

const mapLeadDocumentRow = (leadId, doc) => ({
  _id: doc._id,
  leadId,
  buildingLabel: '',
  category: doc.type === 'photo' || doc.type === 'video' ? doc.type : 'drawing',
  name: doc.name,
  fileUrl: doc.url,
  fileType: '',
  fileSize: 0,
  documentType: doc.type === 'drawing' ? 'other' : doc.type,
  status: doc.approvalStatus || 'pending',
  uploadedBy: doc.uploadedBy,
  uploadedAt: doc.uploadedAt,
  createdAt: doc.uploadedAt,
  updatedAt: doc.reviewedAt || doc.uploadedAt,
  approvalStatus: doc.approvalStatus,
  source: 'lead_documents',
})

const matchesTypeFilter = (row, type) => {
  if (!type) return true
  if (type === 'drawing') {
    return row.category === 'drawing' || row.documentType === 'structural' || row.source === 'plant'
  }
  if (type === 'photo' || type === 'video') {
    return row.category === type || row.documentType === type
  }
  return row.documentType === type || row.category === type
}

const normalizeMergedRow = (doc) => ({
  ...doc,
  fileUrl: doc.fileUrl || doc.url || '',
  name: doc.name || doc.fileName || '',
  source: doc.source || 'drawing_document',
})

const collectDrawingsForLeads = async (leads, typeFilter) => {
  if (!leads.length) return new Map()

  const leadIds = leads.map((l) => l._id)
  const merged = (await getMergedDrawings(leadIds)).map(normalizeMergedRow)

  const uploaderIds = [
    ...new Set(
      merged
        .map((d) => d.uploadedBy)
        .filter(Boolean)
        .map((id) => String(id._id || id))
    ),
  ]
  const uploaders = uploaderIds.length
    ? await User.find({ _id: { $in: uploaderIds } }).select('_id name').lean()
    : []
  const uploaderMap = new Map(uploaders.map((u) => [String(u._id), u.name]))

  const byLead = new Map()

  for (const lead of leads) {
    const key = String(lead._id)
    byLead.set(key, [])
  }

  for (const doc of merged) {
    const key = String(doc.leadId?._id || doc.leadId)
    if (!byLead.has(key)) continue
    if (!matchesTypeFilter(doc, typeFilter)) continue
    byLead.get(key).push({
      ...doc,
      uploadedByName: doc.uploadedBy?.name || uploaderMap.get(String(doc.uploadedBy?._id || doc.uploadedBy)) || '',
    })
  }

  for (const lead of leads) {
    const key = String(lead._id)
    for (const doc of lead.documents || []) {
      const row = mapLeadDocumentRow(lead._id, doc)
      if (!matchesTypeFilter(row, typeFilter)) continue
      byLead.get(key).push(row)
    }
  }

  for (const [key, rows] of byLead) {
    rows.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    byLead.set(key, rows)
  }

  return byLead
}

exports.getDrawings = asyncHandler(async (req, res) => {
  const { type, leadId, search, page = 1, limit = 20 } = req.query

  const filter = {
    isTerminated: { $ne: true },
    isArchived: { $ne: true },
    lifecycleStatus: { $in: CONSTRUCTION_STAGES },
  }
  if (leadId) filter._id = leadId
  if (search?.trim()) {
    filter.$or = [
      { projectName: { $regex: search.trim(), $options: 'i' } },
      { jobId: { $regex: search.trim(), $options: 'i' } },
    ]
  }

  const leads = await Lead.find(filter)
    .select('projectName jobId location documents customerId updatedAt')
    .populate('customerId', 'firstName lastName')
    .lean()

  const drawingsByLead = await collectDrawingsForLeads(leads, type)

  const result = []
  for (const lead of leads) {
    const docs = drawingsByLead.get(String(lead._id)) || []
    if (!docs.length) continue

    const lastUpdate = docs.reduce((max, d) => {
      const t = new Date(d.updatedAt || d.createdAt || d.uploadedAt || 0).getTime()
      return t > max ? t : max
    }, 0)

    result.push({
      leadId: lead._id,
      projectId: lead.jobId,
      projectName: lead.projectName,
      location: lead.location,
      uploadedBy: lead.customerId
        ? `${lead.customerId.firstName || ''} ${lead.customerId.lastName || ''}`.trim()
        : docs[0]?.uploadedByName || '',
      lastUpdate: lastUpdate ? new Date(lastUpdate) : lead.updatedAt,
      documents: docs,
      totalDrawings: docs.length,
    })
  }

  result.sort((a, b) => new Date(b.lastUpdate) - new Date(a.lastUpdate))

  const start = (Number(page) - 1) * Number(limit)
  const paginated = result.slice(start, start + Number(limit))

  return success(res, { projects: paginated, total: result.length })
})

exports.getProjectDrawings = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId)
    .select('projectName jobId location documents customerId lifecycleStatus isTerminated isArchived')
    .populate('customerId', 'firstName lastName')
    .lean()
  if (!lead) return notFound(res, 'Project not found')
  if (lead.isTerminated || lead.isArchived || !CONSTRUCTION_STAGES.includes(lead.lifecycleStatus)) {
    return notFound(res, 'Project is not in construction scope')
  }

  const { type } = req.query
  const drawingsByLead = await collectDrawingsForLeads([lead], type)
  const documents = drawingsByLead.get(String(lead._id)) || []

  return success(res, {
    leadId: lead._id,
    projectId: lead.jobId,
    projectName: lead.projectName,
    documents,
    total: documents.length,
  })
})

exports.uploadDrawing = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { url, name, type = 'drawing' } = req.body
  if (!url || !name) return badRequest(res, 'url and name are required')

  const { DOCUMENT_TYPES } = require('../../models/Lead')
  if (!DOCUMENT_TYPES.includes(type)) {
    return badRequest(res, `type must be one of: ${DOCUMENT_TYPES.join(', ')}`)
  }

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Project not found')

  const doc = {
    url,
    name,
    type,
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  }
  lead.documents.push(doc)
  await lead.save()

  return success(res, { document: lead.documents[lead.documents.length - 1] }, 'Document uploaded')
})

exports.reviewDrawing = asyncHandler(async (req, res) => {
  const { leadId, docId } = req.params
  const { approvalStatus } = req.body
  if (!['approved', 'rejected'].includes(approvalStatus)) {
    return badRequest(res, 'approvalStatus must be approved or rejected')
  }

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Project not found')

  const doc = lead.documents.id(docId)
  if (!doc) return notFound(res, 'Document not found')

  doc.approvalStatus = approvalStatus
  doc.reviewedBy = req.user._id
  doc.reviewedAt = new Date()
  await lead.save()

  return success(res, { document: doc }, 'Document reviewed')
})
