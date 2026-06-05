const mongoose = require('mongoose')
const { BUNDLE_PLAN_STATUSES } = require('../config/constants')

const BundlePlanSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    planNumber: { type: String, required: true, unique: true, trim: true },

    status: {
      type: String,
      enum: BUNDLE_PLAN_STATUSES,
      default: 'generated',
      index: true,
    },

    totalSourceItems: { type: Number, default: 0 },
    totalBundles: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },

    warnings: { type: [String], default: [] },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

BundlePlanSchema.index({ shipperRequestId: 1 }, { unique: true })

module.exports = mongoose.model('BundlePlan', BundlePlanSchema)
