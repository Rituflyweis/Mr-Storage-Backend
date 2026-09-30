const DrawingDocument = require('../models/DrawingDocument')

const STRUCTURAL_FILTER = {
  documentType: 'structural',
  category: 'drawing',
}

/**
 * Keeps a single latest structural drawing per project (DrawingDocument collection).
 */
const replaceProjectStructuralDrawing = async ({
  leadId,
  name,
  fileUrl,
  fileType = '',
  fileSize = 0,
  notes = '',
  buildingLabel = '',
  uploadedBy,
}) => {
  await DrawingDocument.deleteMany({ leadId, ...STRUCTURAL_FILTER })

  return DrawingDocument.create({
    leadId,
    name,
    fileUrl,
    fileType,
    fileSize,
    notes,
    buildingLabel: buildingLabel || '',
    uploadedBy,
    ...STRUCTURAL_FILTER,
    status: 'approved',
    approvedBy: uploadedBy,
    approvedAt: new Date(),
  })
}

const getProjectStructuralDrawing = (leadId) =>
  DrawingDocument.findOne({ leadId, ...STRUCTURAL_FILTER })
    .sort({ createdAt: -1 })
    .populate('uploadedBy', 'name email role')
    .lean()

module.exports = {
  replaceProjectStructuralDrawing,
  getProjectStructuralDrawing,
  STRUCTURAL_FILTER,
}
