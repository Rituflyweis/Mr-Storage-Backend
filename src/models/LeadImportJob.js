const mongoose = require('mongoose')

const LeadImportJobSchema = new mongoose.Schema(
  {
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    panel: { type: String, enum: ['admin', 'sales'], required: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    sourceFileName: { type: String, default: '' },
    sheetName: { type: String, default: '' },
    headerRowIndex: { type: Number, default: null },
    totalRows: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    errors: [
      {
        row: Number,
        reason: String,
        leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
      },
    ],
    errorMessage: { type: String, default: null },
    processingStartedAt: { type: Date, default: null },
    processingEndedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

LeadImportJobSchema.index({ createdAt: -1 })

module.exports = mongoose.model('LeadImportJob', LeadImportJobSchema)
