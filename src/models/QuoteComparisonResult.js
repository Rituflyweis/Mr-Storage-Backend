const mongoose = require('mongoose')

const QuoteComparisonResultSchema = new mongoose.Schema(
  {
    shipperRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShipperRequest', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    consolidatedBOMId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsolidatedBOM', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },

    consolidatedItemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    vendorQuoteLineId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorQuoteLine', default: null },
    vendorQuoteLineIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VendorQuoteLine',
      },
    ],

    status: {
      type: String,
      enum: [
        'matched',
        'missing_in_vendor_quote',
        'extra_in_vendor_quote',
        'qty_mismatch',
        'length_mismatch',
        'weight_mismatch',
        'part_mismatch',
        'price_mismatch',
        'ambiguous_match',
      ],
      required: true,
      index: true,
    },

    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },

    expected: { type: mongoose.Schema.Types.Mixed, default: null },
    received: { type: mongoose.Schema.Types.Mixed, default: null },
    difference: { type: mongoose.Schema.Types.Mixed, default: null },

    matchConfidence: { type: Number, min: 0, max: 1, default: null },
    matchMethod: {
      type: String,
      enum: [
        'exact_part_color_length',
        'part_length_grouped',
        'part_only_grouped',
        'piece_mark',
        'alias',
        'description_ai_suggestion',
        'none',
      ],
      default: 'none',
    },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
)

QuoteComparisonResultSchema.index({ consolidatedBOMId: 1, vendorId: 1 })

module.exports = mongoose.model('QuoteComparisonResult', QuoteComparisonResultSchema)
