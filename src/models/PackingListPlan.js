const mongoose = require('mongoose')
const { PACKING_LIST_PLAN_STATUSES } = require('../config/constants')

const PackingListPlanSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },

    planNumber: { type: String, required: true, unique: true, trim: true },
    status: {
      type: String,
      enum: PACKING_LIST_PLAN_STATUSES,
      default: 'generated',
      index: true,
    },

    totalPackingLists: { type: Number, default: 0 },
    totalBundles: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },

    truckSummary: {
      semi53Count: { type: Number, default: 0 },
      hotshot40Count: { type: Number, default: 0 },
      totalTrucks: { type: Number, default: 0 },
    },

    warnings: { type: [String], default: [] },
    overrideReason: { type: String, default: '' },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

PackingListPlanSchema.index({ bundlePlanId: 1 }, { unique: true })

module.exports = mongoose.model('PackingListPlan', PackingListPlanSchema)
