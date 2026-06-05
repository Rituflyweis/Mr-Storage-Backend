const mongoose = require('mongoose')

const VendorQuoteLineSchema = new mongoose.Schema(
  {
    shipperRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShipperRequest',
      required: true,
      index: true,
    },

    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },

    consolidatedBOMId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ConsolidatedBOM',
      required: true,
      index: true,
    },

    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },

    pageNumber: { type: Number, default: null },
    rowNumber: { type: Number, default: null },
    vendorLineNo: { type: String, default: '' },

    /**
     * qty = comparable physical quantity where available.
     * For Central States, qty should be pieceQty, not LF quantity.
     */
    qty: { type: Number, default: null },

    /**
     * Central States / LF-based quote support.
     */
    pieceQty: { type: Number, default: null },
    totalLinearFeet: { type: Number, default: null },
    uom: { type: String, default: null },

    partCode: { type: String, default: null },
    partCodeNormalized: { type: String, default: null, index: true },

    vendorProductCode: { type: String, default: null },
    vendorProductCodeNormalized: { type: String, default: null, index: true },

    description: { type: String, default: '' },

    pieceMark: { type: String, default: '' },
    pieceMarkNormalized: { type: String, default: '', index: true },

    color: { type: String, default: null },
    colorNormalized: { type: String, default: null, index: true },

    lengthText: { type: String, default: null },
    lengthFeet: { type: Number, default: null },

    weight: { type: Number, default: null },

    unitPrice: { type: Number, default: null },

    priceUnit: {
      type: String,
      enum: ['EA', 'FT', 'LF', 'LB', 'LOT', 'UNKNOWN'],
      default: 'UNKNOWN',
    },

    amount: { type: Number, default: null },

    punchInfo: { type: String, default: '' },
    leftPunch: { type: String, default: '' },
    rightPunch: { type: String, default: '' },

    bendInfo: { type: String, default: '' },
    notes: { type: String, default: '' },

    extractionMethod: {
      type: String,
      enum: ['pdf_text', 'ocr', 'claude', 'excel', 'csv', 'hybrid'],
      default: 'hybrid',
      index: true,
    },

    extractionFormat: {
      type: String,
      enum: [
        'quicken_steel',
        'central_states',
        'mbs_material_report',
        'generic_material_pdf',
        'excel',
        'csv',
      ],
      default: 'generic_material_pdf',
      index: true,
    },

    extractionConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    warnings: {
      type: [String],
      default: [],
    },

    rawText: { type: String, default: '' },
    rawRow: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
)

VendorQuoteLineSchema.index({
  shipperRequestId: 1,
  partCodeNormalized: 1,
  lengthFeet: 1,
})

VendorQuoteLineSchema.index({
  shipperRequestId: 1,
  pieceMarkNormalized: 1,
})

VendorQuoteLineSchema.index({
  partCodeNormalized: 1,
  colorNormalized: 1,
})

module.exports = mongoose.model('VendorQuoteLine', VendorQuoteLineSchema)