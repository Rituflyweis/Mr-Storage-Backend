const Lead = require('../../models/Lead')
const { getMergedDrawings } = require('../../utils/drawingSources')
const { success, notFound, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const filterDocs = (docs, query) => {
  const { documentType, status, category, buildingLabel, source, projectId, leadId } = query
  return docs.filter((d) => {
    if (projectId && String(d.leadId) !== String(projectId)) return false
    if (leadId && String(d.leadId) !== String(leadId)) return false
    if (documentType && d.documentType !== documentType) return false
    if (status && d.status !== status) return false
    if (category && d.category !== category) return false
    if (buildingLabel && d.buildingLabel !== buildingLabel) return false
    if (source === 'plant' && d.source !== 'plant') return false
    if (source === 'document' && d.source === 'plant') return false
    return true
  })
}

const resolveLeadScope = async (user, query) => {
  if (user.role === 'admin') return { leadIds: null }

  if (user.role === 'sales') {
    const filter = { assignedSales: user._id, isTerminated: { $ne: true } }
    if (query.projectId || query.leadId) {
      const id = query.projectId || query.leadId
      const ok = await Lead.exists({ _id: id, assignedSales: user._id })
      if (!ok) return { error: 'Access denied', code: 403 }
      return { leadIds: [id] }
    }
    const leadIds = await Lead.find(filter).distinct('_id')
    return { leadIds }
  }

  return { error: 'Access denied', code: 403 }
}

exports.listProjectDrawingsAndDocuments = asyncHandler(async (req, res) => {
  const scope = await resolveLeadScope(req.user, req.query)
  if (scope.error) return forbidden(res, scope.error)

  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))

  let merged
  if (scope.leadIds === null) {
    if (req.query.projectId || req.query.leadId) {
      merged = await getMergedDrawings(req.query.projectId || req.query.leadId)
    } else {
      merged = await getMergedDrawings()
    }
  } else if (!scope.leadIds.length) {
    merged = []
  } else if (req.query.projectId || req.query.leadId) {
    merged = await getMergedDrawings(req.query.projectId || req.query.leadId)
  } else {
    merged = await getMergedDrawings(scope.leadIds)
  }

  const filtered = filterDocs(merged, req.query)
  const total = filtered.length
  const skip = (page - 1) * limit
  const documents = filtered.slice(skip, skip + limit)

  const leadIds = [...new Set(documents.map((d) => String(d.leadId)))]
  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select('projectName jobId location customerId')
    .lean()
  const leadMap = new Map(leads.map((l) => [String(l._id), l]))

  const rows = documents.map((d) => ({
    ...d,
    projectName: leadMap.get(String(d.leadId))?.projectName || '',
    jobId: leadMap.get(String(d.leadId))?.jobId || '',
    isLatest: true,
  }))

  return success(res, {
    documents: rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  })
})

exports.listProjectDrawingsGrouped = asyncHandler(async (req, res) => {
  req.query.limit = req.query.limit || 500
  const scope = await resolveLeadScope(req.user, req.query)
  if (scope.error) return forbidden(res, scope.error)

  let merged
  if (scope.leadIds === null) {
    merged = await getMergedDrawings(req.query.projectId || req.query.leadId || undefined)
  } else if (!scope.leadIds.length) {
    merged = []
  } else {
    merged = await getMergedDrawings(
      req.query.projectId || req.query.leadId ? req.query.projectId || req.query.leadId : scope.leadIds
    )
  }

  const filtered = filterDocs(merged, req.query)
  const leadIds = [...new Set(filtered.map((d) => String(d.leadId)))]
  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select('projectName jobId location')
    .lean()
  const leadMap = new Map(leads.map((l) => [String(l._id), l]))

  const grouped = {}
  for (const doc of filtered) {
    const key = String(doc.leadId)
    const lead = leadMap.get(key)
    if (!lead) continue
    if (!grouped[key]) {
      grouped[key] = {
        leadId: lead._id,
        projectName: lead.projectName,
        jobId: lead.jobId,
        location: lead.location,
        documents: [],
        lastUpdate: doc.updatedAt,
      }
    }
    grouped[key].documents.push(doc)
    if (doc.updatedAt > grouped[key].lastUpdate) grouped[key].lastUpdate = doc.updatedAt
  }

  return success(res, { projects: Object.values(grouped) })
})
