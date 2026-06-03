const mongoose = require('mongoose')

const ShipperComparisonJobSchema = new mongoose.Schema(
  {
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued', index: true },
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
    resultCount: { type: Number, default: 0 },
    errorMessage: { type: String, default: null },
    processingStartedAt: { type: Date, default: null },
    processingEndedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

ShipperComparisonJobSchema.index({ shipperRequestId: 1, createdAt: -1 })

module.exports = mongoose.model('ShipperComparisonJob', ShipperComparisonJobSchema)
