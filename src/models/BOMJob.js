const mongoose = require('mongoose')
const { BOM_JOB_STATUSES, BOM_FILE_FORMATS } = require('../config/constants')

const BOMJobSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true },
    buildingNumber: { type: Number, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    fileName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileFormat: { type: String, enum: BOM_FILE_FORMATS, required: true },

    status: {
      type: String,
      enum: BOM_JOB_STATUSES,
      default: 'queued',
    },

    extractionMethod: { type: String, enum: ['exceljs', 'claude_fallback'], default: 'exceljs' },
    skippedSheets: {
      type: [{ name: String, reason: String }],
      default: [],
    },

    totalSheets: { type: Number, default: 0 },
    totalItems: { type: Number, default: 0 },
    matchedItems: { type: Number, default: 0 },
    unmatchedItems: { type: Number, default: 0 },
    frameItems: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },

    errorMessage: { type: String, default: null },

    isConfirmed: { type: Boolean, default: false },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },

    processingStartedAt: { type: Date, default: null },
    processingEndedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

BOMJobSchema.index({ leadId: 1, buildingId: 1 })
BOMJobSchema.index({ status: 1 })

module.exports = mongoose.model('BOMJob', BOMJobSchema)
