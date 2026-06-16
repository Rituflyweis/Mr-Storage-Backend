const mongoose = require('mongoose')
const { SHIPPER_REQUEST_STATUSES } = require('../config/constants')

const ShipperRequestSchema = new mongoose.Schema(
  {
    leadId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    consolidatedBOMId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedBOM', required: true },
    vendorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    token:             { type: String, required: true, unique: true },
    tokenExpiresAt:    { type: Date, default: null },
    ourFileUrl:        { type: String, default: null },
    sentAt:            { type: Date, default: Date.now },
    status:            { type: String, enum: SHIPPER_REQUEST_STATUSES, default: 'sent' },
    submittedFileUrl:  { type: String, default: null },
    submittedAt:       { type: Date, default: null },
    submittedFileName: { type: String, default: '' },
    quoteValue:        { type: Number, default: null },
    reviewedAt:        { type: Date, default: null },
    reviewedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    exceptions:        { type: [mongoose.Schema.Types.Mixed], default: [] },
    vendorExceptionSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    manualReviewNote:  { type: String, default: '' },
    resubmitCount:     { type: Number, default: 0 },
    resubmitRequestedAt: { type: Date, default: null },
    submissionHistory: {
      type: [{
        submittedFileUrl: { type: String, default: null },
        submittedFileName: { type: String, default: '' },
        quoteValue: { type: Number, default: null },
        submittedAt: { type: Date, default: null },
        token: { type: String, default: '' },
        comparisonSummary: { type: mongoose.Schema.Types.Mixed, default: null },
        exceptionsCount: { type: Number, default: 0 },
      }],
      default: [],
    },
    comparisonStatus:  { type: String, enum: ['idle', 'processing', 'completed', 'failed'], default: 'idle' },
    comparisonSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    comparisonError:   { type: String, default: null },
    comparisonRanAt:   { type: Date, default: null },
  },
  { timestamps: true }
)

ShipperRequestSchema.index({ leadId: 1 })
ShipperRequestSchema.index({ vendorId: 1 })
ShipperRequestSchema.index({ status: 1 })

module.exports = mongoose.model('ShipperRequest', ShipperRequestSchema)
