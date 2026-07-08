const Lead = require('../../models/Lead')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.getDrawings = asyncHandler(async (req, res) => {
  const { type, leadId, page = 1, limit = 20 } = req.query

  const filter = { isTerminated: { $ne: true } }
  if (leadId) filter._id = leadId

  const leads = await Lead.find(filter)
    .select('projectName jobId location documents customerId updatedAt')
    .populate('customerId', 'firstName lastName')
    .lean()

  const result = []
  for (const lead of leads) {
    let docs = lead.documents || []
    if (type) docs = docs.filter((d) => d.type === type)
    if (!docs.length) continue
    result.push({
      leadId: lead._id,
      projectId: lead.jobId,
      projectName: lead.projectName,
      location: lead.location,
      uploadedBy: lead.customerId
        ? `${lead.customerId.firstName || ''} ${lead.customerId.lastName || ''}`.trim()
        : '',
      lastUpdate: lead.updatedAt,
      documents: docs,
    })
  }

  const start = (Number(page) - 1) * Number(limit)
  const paginated = result.slice(start, start + Number(limit))

  return success(res, { projects: paginated, total: result.length })
})

exports.getProjectDrawings = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId)
    .select('projectName jobId location documents customerId')
    .populate('customerId', 'firstName lastName')
    .lean()
  if (!lead) return notFound(res, 'Project not found')

  const { type } = req.query
  let docs = lead.documents || []
  if (type) docs = docs.filter((d) => d.type === type)

  return success(res, {
    leadId: lead._id,
    projectId: lead.jobId,
    projectName: lead.projectName,
    documents: docs,
  })
})

exports.uploadDrawing = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { url, name, type = 'drawing' } = req.body
  if (!url || !name) return badRequest(res, 'url and name are required')

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
