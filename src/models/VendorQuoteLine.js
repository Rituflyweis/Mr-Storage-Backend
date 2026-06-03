const mongoose = require('mongoose')

const VendorQuoteLineSchema = new mongoose.Schema(
  {
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    consolidatedBOMId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedBOM', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },

    pageNumber: { type: Number, default: null },
    rowNumber: { type: Number, default: null },
    vendorLineNo: { type: String, default: '' },

    qty: { type: Number, default: null },
    partCode: { type: String, default: null },
    partCodeNormalized: { type: String, default: null, index: true },
    description: { type: String, default: '' },
    pieceMark: { type: String, default: '' },
    pieceMarkNormalized: { type: String, default: '', index: true },
    color: { type: String, default: null },
    colorNormalized: { type: String, default: null, index: true },
    lengthText: { type: String, default: null },
    lengthFeet: { type: Number, default: null },
    weight: { type: Number, default: null },

    unitPrice: { type: Number, default: null },
    priceUnit: { type: String, enum: ['EA', 'FT', 'LB', 'LOT', 'UNKNOWN'], default: 'UNKNOWN' },
    amount: { type: Number, default: null },

    punchInfo: { type: String, default: '' },
    bendInfo: { type: String, default: '' },
    notes: { type: String, default: '' },

    extractionMethod: { type: String, enum: ['pdf_text', 'ocr', 'claude', 'excel', 'hybrid'], default: 'hybrid' },
    extractionConfidence: { type: Number, min: 0, max: 1, default: null },
    warnings: { type: [String], default: [] },

    rawText: { type: String, default: '' },
    rawRow: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
)

VendorQuoteLineSchema.index({ shipperRequestId: 1 })
VendorQuoteLineSchema.index({ shipperRequestId: 1, partCodeNormalized: 1, lengthFeet: 1 })
VendorQuoteLineSchema.index({ partCodeNormalized: 1, colorNormalized: 1 })
VendorQuoteLineSchema.index({ pieceMarkNormalized: 1 })

module.exports = mongoose.model('VendorQuoteLine', VendorQuoteLineSchema)
