const mongoose = require('mongoose')
const { PACKING_LIST_STATUSES, TRUCK_TYPES } = require('../config/constants')

const PackingListSchema = new mongoose.Schema(
  {
    packingListPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackingListPlan', required: true, index: true },
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },

    packingListNo: { type: String, required: true, index: true },
    truckNo: { type: String, required: true },
    truckType: { type: String, enum: TRUCK_TYPES, required: true, index: true },
    truckLabel: { type: String, default: '' },
    maxTruckWeight: { type: Number, required: true },
    hardMaxTruckWeight: { type: Number, default: null },
    maxTruckLengthFeet: { type: Number, required: true },

    bundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
    totalBundles: { type: Number, default: 0 },
    totalItems: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },

    loadLayout: {
      bottomLayerBundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
      middleLayerBundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
      topLayerBundleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Bundle' }],
      loadingNotes: { type: String, default: '' },
    },

    warnings: { type: [String], default: [] },
    overrideReason: { type: String, default: '' },
    status: {
      type: String,
      enum: PACKING_LIST_STATUSES,
      default: 'draft',
      index: true,
    },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

PackingListSchema.index({ packingListPlanId: 1, packingListNo: 1 }, { unique: true })

module.exports = mongoose.model('PackingList', PackingListSchema)
