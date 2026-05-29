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
  },
  { timestamps: true }
)

ShipperRequestSchema.index({ leadId: 1 })
ShipperRequestSchema.index({ vendorId: 1 })
ShipperRequestSchema.index({ status: 1 })

module.exports = mongoose.model('ShipperRequest', ShipperRequestSchema)
