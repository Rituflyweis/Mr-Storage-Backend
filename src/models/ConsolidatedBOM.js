const mongoose = require('mongoose')
const { CONSOLIDATED_BOM_STATUSES } = require('../config/constants')

const ConsolidatedItemSchema = new mongoose.Schema(
  {
    partCode: { type: String, default: null },
    partColor: { type: String, default: null },
    description: { type: String, default: '' },
    category: { type: String, default: '' },

    costUnit: {
      type: String,
      enum: ['FT', 'LB', 'EA', null],
      default: null,
    },

    unitCost: {
      type: Number,
      default: null,
    },

    totalQty: { type: Number, default: 0 },
    totalLengthFeet: { type: Number, default: 0 },
    totalWeight: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },

    buildings: { type: [Number], default: [] },
    markIds: { type: [String], default: [] },

    bomItemIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BOMItem',
      },
    ],

    sourceLineCount: {
      type: Number,
      default: 0,
    },

    isFullyPriced: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
)

const SentVendorSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
    sentAt: { type: Date, default: Date.now },
    token: { type: String, required: true },
  },
  { _id: true }
)

const ConsolidatedBOMSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      unique: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    status: {
      type: String,
      enum: CONSOLIDATED_BOM_STATUSES,
      default: 'draft',
    },

    fileUrl: {
      type: String,
      default: null,
    },

    totalCost: {
      type: Number,
      default: 0,
    },

    totalWeight: {
      type: Number,
      default: 0,
    },

    totalPanelsArea: {
      type: Number,
      default: 0,
    },

    items: {
      type: [ConsolidatedItemSchema],
      default: [],
    },

    sentToVendors: {
      type: [SentVendorSchema],
      default: [],
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ConsolidatedBOM', ConsolidatedBOMSchema)