const Lead = require('../../models/Lead')
const {
  replaceProjectStructuralDrawing,
  getProjectStructuralDrawing,
} = require('../../services/structuralDrawing.service')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const { PLANT_LIFECYCLE_STAGES } = require('../../config/constants')

const isConstructionStageLead = (lead) =>
  lead && lead.isTerminated !== true && PLANT_LIFECYCLE_STAGES.includes(lead.lifecycleStatus)

const assertLeadForStructuralUpload = async (leadId, req) => {
  const lead = await Lead.findById(leadId).select('_id lifecycleStatus isTerminated assignedSales').lean()
  if (!lead) return { error: 'Project not found', code: 404 }

  if (req.user.role === 'sales') {
    if (String(lead.assignedSales) !== String(req.user._id)) {
      return { error: 'Access denied', code: 403 }
    }
    return { lead }
  }

  if (req.user.role === 'construction' || req.user.role === 'admin') {
    if (!isConstructionStageLead(lead) && req.user.role === 'construction') {
      return { error: 'Project is not in construction scope', code: 403 }
    }
    return { lead }
  }

  if (req.user.role === 'plant') {
    return assertPlantProjectAccess(leadId, req)
  }

  return { error: 'Access denied', code: 403 }
}

exports.uploadProjectStructuralDrawing = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { name, fileUrl, fileType, fileSize, notes, buildingLabel } = req.body
  if (!name?.trim() || !fileUrl?.trim()) {
    return badRequest(res, 'name and fileUrl are required')
  }

  const access = await assertLeadForStructuralUpload(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const document = await replaceProjectStructuralDrawing({
    leadId,
    name: name.trim(),
    fileUrl: fileUrl.trim(),
    fileType,
    fileSize,
    notes,
    buildingLabel,
    uploadedBy: req.user._id,
  })

  return success(res, { document, replacedPrevious: true }, 'Structural drawing uploaded (previous version replaced)')
})

exports.getProjectStructuralDrawing = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertLeadForStructuralUpload(leadId, req)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const document = await getProjectStructuralDrawing(leadId)
  if (!document) {
    return success(res, { document: null, hasStructuralDrawing: false })
  }

  return success(res, { document, hasStructuralDrawing: true })
})
