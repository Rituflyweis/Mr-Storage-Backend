const mongoose = require('mongoose')

const DOC_TYPES = ['architectural', 'structural', 'fabrication', 'erection', 'specification', 'other']
const DOC_STATUSES = ['pending', 'approved', 'rejected', 'under_review']
const DOC_CATEGORIES = ['drawing', 'photo', 'document']

const DrawingDocumentSchema = new mongoose.Schema(
  {
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    buildingLabel: { type: String, default: '', trim: true, index: true },
    category:     { type: String, enum: DOC_CATEGORIES, default: 'drawing' },
    name:         { type: String, required: true, trim: true },
    fileUrl:      { type: String, required: true, trim: true },
    fileType:     { type: String, default: '', trim: true },
    fileSize:     { type: Number, default: 0 },
    documentType: { type: String, enum: DOC_TYPES, default: 'other' },
    status:       { type: String, enum: DOC_STATUSES, default: 'pending' },
    uploadedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt:      { type: Date, default: null },
    notes:           { type: String, default: '', trim: true },
    revisionNote:    { type: String, default: '', trim: true },
    revisionRequestedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

DrawingDocumentSchema.index({ leadId: 1, documentType: 1 })
DrawingDocumentSchema.index({ createdAt: -1 })

module.exports = mongoose.model('DrawingDocument', DrawingDocumentSchema)
module.exports.DOC_TYPES = DOC_TYPES
module.exports.DOC_STATUSES = DOC_STATUSES
module.exports.DOC_CATEGORIES = DOC_CATEGORIES
