const mongoose = require('mongoose')
const { SMDT_COST_UNITS } = require('../config/constants')

const SMDTItemSchema = new mongoose.Schema(
  {
    costVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SMDTCostVersion', required: true, index: true },

    category: { type: String, required: true, trim: true, index: true },

    partName: { type: String, required: true, trim: true },
    partNameNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },

    partColor: { type: String, default: null, trim: true },
    partColorNormalized: { type: String, default: null, trim: true, uppercase: true, index: true },

    costUnit: { type: String, enum: SMDT_COST_UNITS, required: true },
    mbsCost: { type: Number, required: true },
    currentMarketCost: { type: Number, default: null },

    laborCost: { type: Number, default: 0 },
    additionalCost: { type: Number, default: 0 },
    materialCost: { type: Number, default: 0 },
    extraMinCost: { type: Number, default: 0 },
    extraMaxCost: { type: Number, default: 0 },

    isFrameType: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    description: { type: String, default: '' },

    rawRow: { type: mongoose.Schema.Types.Mixed, default: null },
    rowNumber: { type: Number, default: null },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastImportedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

SMDTItemSchema.index(
  { costVersionId: 1, category: 1, partNameNormalized: 1, partColorNormalized: 1 },
  { unique: true }
)
SMDTItemSchema.index({ costVersionId: 1, partNameNormalized: 1 })
SMDTItemSchema.index({ costVersionId: 1, category: 1 })
SMDTItemSchema.index({ partName: 'text', description: 'text' })

module.exports = mongoose.model('SMDTItem', SMDTItemSchema)
