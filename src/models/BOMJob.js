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

    extractionMethod: {
      type: String,
      enum: ['exceljs', 'claude_fallback', 'xlsx', 'out_parser'],
      default: 'xlsx',
    },
    skippedSheets: {
      type: [{ name: String, reason: String }],
      default: [],
    },
    ambiguousItems: {
      type: Number,
      default: 0,
    },

    totalSheets: { type: Number, default: 0 },
    totalItems: { type: Number, default: 0 },
    matchedItems: { type: Number, default: 0 },
    unmatchedItems: { type: Number, default: 0 },

    // Items priced from the BOM file's own cost column (SMDT had no match)
    bomPricedItems: { type: Number, default: 0 },
    // Items with no price from any source — need manual pricing
    unpricedItems: { type: Number, default: 0 },

    frameItems: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },

    // FIX #6: parse audit fields.
    // parseAudit stores the cost/weight delta between what the parser extracted
    // and what the .out file's own section Total rows report. A costDelta > 0.5
    // means at least one item was likely missed during extraction.
    // parseSuspect is the boolean flag derived from that delta — surfaced in
    // the UI and socket events so users know to re-check a suspicious parse
    // without having to inspect raw numbers.
    // Both are null/false for xlsx and claude_fallback jobs (no built-in totals
    // to compare against).
    parseAudit: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    parseSuspect: {
      type: Boolean,
      default: false,
    },

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