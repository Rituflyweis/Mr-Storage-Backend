// Shared logic for merging the two independent drawing storage systems that exist in this
// codebase, so every panel (customer/admin/plant) sees the same combined picture and no endpoint
// silently loses the other source's data:
//
//   1. DrawingDocument  — admin/customer's own upload+approve+comment flow.
//   2. Building.drawings — Plant Panel's per-building, versioned fabrication drawings.
//
// Duplicating this merge logic per-controller is exactly how the original "customer sees empty
// drawings" bug happened — any endpoint that needs drawings for a lead should use this module
// instead of querying DrawingDocument directly.

const DrawingDocument = require('../models/DrawingDocument')
const Building = require('../models/Building')

const BUILDING_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Plant's Building.buildingNumber (1, 2, 3...) -> the "Building A"/"Building B" label convention
// used by DrawingDocument.buildingLabel, so both drawing sources line up under the same building.
const buildingNumberToLabel = (n) => `Building ${BUILDING_LETTERS[n - 1] || n}`

const PLANT_DRAWING_STATUS_MAP = { pending_review: 'pending', approved: 'approved', rejected: 'rejected' }

// Maps a Building.drawings subdocument onto the same field shape as a DrawingDocument, so both
// sources can be merged into a single array/count without changing any response structure.
const mapPlantDrawing = (buildingDoc, drawing, leadId) => ({
  _id: drawing._id,
  leadId,
  buildingLabel: buildingNumberToLabel(buildingDoc.buildingNumber),
  category: 'drawing',
  name: drawing.fileName,
  fileUrl: drawing.fileUrl,
  fileType: '',
  fileSize: 0,
  documentType: 'other',
  status: PLANT_DRAWING_STATUS_MAP[drawing.status] || drawing.status,
  uploadedBy: drawing.uploadedBy,
  approvedBy: null,
  approvedAt: drawing.status === 'approved' ? drawing.reviewedAt : null,
  notes: drawing.rejectionReason || '',
  revisionNote: drawing.rejectionReason || '',
  revisionRequestedAt: drawing.status === 'rejected' ? drawing.reviewedAt : null,
  comments: drawing.comments || [],
  versionNumber: drawing.versionNumber,
  createdAt: drawing.uploadedAt,
  updatedAt: drawing.reviewedAt || drawing.uploadedAt,
  source: 'plant',
})

const POPULATE_DOC = [
  { path: 'uploadedBy', select: 'name' },
  { path: 'approvedBy', select: 'name' },
  { path: 'comments.commentedBy', select: 'name' },
  { path: 'comments.commentedByCustomer', select: 'firstName lastName' },
]
const POPULATE_PLANT = [
  { path: 'drawings.uploadedBy', select: 'name' },
  { path: 'drawings.comments.commentedBy', select: 'name' },
  { path: 'drawings.comments.commentedByCustomer', select: 'firstName lastName' },
]

// Fetches and merges both sources. Pass a leadId (single lead), an array of leadIds (cross-project
// listing screens), or omit entirely for "every lead" (admin-wide drawing list). Returns a flat,
// sorted array in the DrawingDocument shape.
const getMergedDrawings = async (leadIdOrIds) => {
  const leadFilter = {}
  if (Array.isArray(leadIdOrIds)) leadFilter.leadId = { $in: leadIdOrIds }
  else if (leadIdOrIds) leadFilter.leadId = leadIdOrIds

  const [drawingDocs, buildings] = await Promise.all([
    DrawingDocument.find(leadFilter).populate(POPULATE_DOC).lean(),
    Building.find(leadFilter).select('leadId buildingNumber drawings').populate(POPULATE_PLANT).lean(),
  ])

  const plantMapped = buildings.flatMap((b) =>
    (b.drawings || []).map((d) => mapPlantDrawing(b, d, b.leadId))
  )

  return [...drawingDocs, ...plantMapped].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

// Resolves a docId to either a DrawingDocument or a Building.drawings subdocument — lets
// approve/revision/comment endpoints work regardless of which panel originally uploaded the file.
const resolveDrawingRef = async (leadId, docId) => {
  const doc = await DrawingDocument.findOne({ _id: docId, leadId })
  if (doc) return { source: 'document', doc }

  const building = await Building.findOne({ leadId, 'drawings._id': docId })
  if (building) {
    const drawing = building.drawings.id(docId)
    if (drawing) return { source: 'plant', building, drawing }
  }
  return null
}

module.exports = { buildingNumberToLabel, mapPlantDrawing, getMergedDrawings, resolveDrawingRef }
