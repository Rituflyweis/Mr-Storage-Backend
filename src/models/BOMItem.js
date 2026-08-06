const mongoose = require('mongoose')
const { BOM_MATCH_STATUSES, BOM_MATCH_CONFIDENCE, BOM_PRICE_SOURCES } = require('../config/constants')

const BOMItemSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    buildingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Building', required: true },
    bomJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'BOMJob', required: true },
    smdtCostVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SMDTCostVersion', default: null },

    sourceSheetName: { type: String, default: '' },
    category: { type: String, default: '' },
    rowNumber: { type: Number, default: null },

    quantity: { type: Number, default: null },
    markId: { type: String, default: '' },
    description: { type: String, default: '' },

    partCode: { type: String, default: null },
    partCodeNormalized: { type: String, default: null, index: true },
    partColor: { type: String, default: null },
    partColorNormalized: { type: String, default: null, index: true },
    resolvedSmdtColor: { type: String, default: null },

    lengthRaw: { type: String, default: null },
    lengthFeet: { type: Number, default: null },
    weight: { type: Number, default: null },
    type: { type: String, default: null },
    gauge: { type: String, default: null },
    angle: { type: String, default: null },

    isFrameType: { type: Boolean, default: false },
    isBuyout: { type: Boolean, default: false },
    rawRow: { type: mongoose.Schema.Types.Mixed, default: null },

    smdtItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'SMDTItem', default: null },
    matchStatus: { type: String, enum: BOM_MATCH_STATUSES, default: 'unmatched', index: true },
    matchConfidence: { type: String, enum: BOM_MATCH_CONFIDENCE, default: 'none' },
    matchReason: { type: String, default: '' },
    matchCandidates: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // SMDT-derived price. Only populated when there is a real SMDT match.
    costUnit: { type: String, default: null },
    smdtUnitCost: { type: Number, default: null },
    smdtTotalCost: { type: Number, default: null },

    // Price extracted from the source BOM file itself (e.g. MBS .out reports
    // carry a Total Cost column). Stored independently of matching so both
    // prices are always available for comparison.
    bomSourceUnitCost: { type: Number, default: null },
    bomSourceTotalCost: { type: Number, default: null },

    isManuallyPriced: { type: Boolean, default: false },
    manualUnitCost: { type: Number, default: null },
    manualTotalCost: { type: Number, default: null },
    manualPriceSavedToSMDT: { type: Boolean, default: false },

    // Which source produced finalUnitCost / finalTotalCost.
    // 'smdt'   -> matched against SMDT cost data
    // 'bom'    -> SMDT had no match; BOM file's own price used as fallback
    // 'manual' -> user entered a price
    priceSource: { type: String, enum: BOM_PRICE_SOURCES, default: null, index: true },

    isPriced: { type: Boolean, default: false, index: true },
    finalUnitCost: { type: Number, default: null },
    finalTotalCost: { type: Number, default: null },
  },
  { timestamps: true }
)

BOMItemSchema.index({ bomJobId: 1 })
BOMItemSchema.index({ leadId: 1, buildingId: 1 })

module.exports = mongoose.model('BOMItem', BOMItemSchema)
