const mongoose = require('mongoose')

const SMDTCostVersionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sourceFileName: { type: String, default: '' },
    sourceFileUrl: { type: String, default: '' },
    effectiveDate: { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    stats: {
      totalItems: { type: Number, default: 0 },
      inserted: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      skippedRows: { type: Number, default: 0 },
      duplicateRows: { type: Number, default: 0 },
      sheets: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
  },
  { timestamps: true }
)

SMDTCostVersionSchema.index({ isActive: 1, createdAt: -1 })

module.exports = mongoose.model('SMDTCostVersion', SMDTCostVersionSchema)
