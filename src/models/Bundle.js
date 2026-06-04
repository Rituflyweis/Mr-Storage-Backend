const mongoose = require('mongoose')
const { BUNDLE_STATUSES } = require('../config/constants')

const BundleItemSchema = new mongoose.Schema(
  {
    vendorQuoteLineId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuoteLine', required: true, index: true },
    partCode: { type: String, default: '' },
    description: { type: String, default: '' },
    category: { type: String, default: '' },
    color: { type: String, default: '' },
    qty: { type: Number, required: true },
    lengthFeet: { type: Number, default: null },
    widthFeet: { type: Number, default: null },
    heightFeet: { type: Number, default: null },
    weight: { type: Number, default: 0 },
    markIds: { type: [String], default: [] },
    sourceLineSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
)

const BundleSchema = new mongoose.Schema(
  {
    bundlePlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'BundlePlan', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },

    bundleNo: { type: String, required: true, index: true },
    bundleType: {
      type: String,
      enum: ['panels', 'trim', 'framing', 'fasteners', 'accessories', 'mixed', 'custom'],
      default: 'mixed',
      index: true,
    },
    title: { type: String, default: '' },
    items: { type: [BundleItemSchema], default: [] },

    totalQty: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    maxLengthFeet: { type: Number, default: 0 },
    estimatedWidthFeet: { type: Number, default: null },
    estimatedHeightFeet: { type: Number, default: null },

    packingListId: { type: mongoose.Schema.Types.ObjectId, ref: 'PackingList', default: null, index: true },

    status: {
      type: String,
      enum: BUNDLE_STATUSES,
      default: 'draft',
      index: true,
    },

    stacking: {
      stackLevel: { type: String, enum: ['bottom', 'middle', 'top', 'any'], default: 'any' },
      canStackOnTop: { type: Boolean, default: true },
      canHaveItemsStackedOnIt: { type: Boolean, default: true },
      isFragile: { type: Boolean, default: false },
      mustStayFlat: { type: Boolean, default: false },
      keepDry: { type: Boolean, default: false },
      requiresEdgeProtection: { type: Boolean, default: false },
      loadingPriority: { type: Number, default: 50 },
      unloadingPriority: { type: Number, default: 50 },
      stackingNotes: { type: String, default: '' },
    },

    loadSequence: { type: Number, default: null },
    handlingInstruction: { type: String, default: '' },
    warnings: { type: [String], default: [] },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

BundleSchema.index({ bundlePlanId: 1, bundleNo: 1 }, { unique: true })

module.exports = mongoose.model('Bundle', BundleSchema)
