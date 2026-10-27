const mongoose = require('mongoose')

/**
 * Drop-in replacement for the SM-QuotingTool v7 Firebase RTDB quote cache.
 * Mirrors /quotes/{id} and /changeOrders/{id}. `data` holds the client-side
 * record verbatim (the MVP's state_data blob or CO row) so the frontend keeps
 * working exactly as it did against Firebase, but persisted server-side.
 */
const SavedQuoteSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['quote', 'co'], required: true, index: true },
    recordId: { type: String, required: true }, // the client-generated id
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // denormalised for cheap listing / filtering
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    employeeName: { type: String, default: '' },
    customer: { type: String, default: '' },
    grandTotal: { type: Number, default: 0 },
    status: { type: String, default: 'Draft' },
  },
  { timestamps: true },
)

SavedQuoteSchema.index({ kind: 1, recordId: 1 }, { unique: true })

module.exports = mongoose.model('SavedQuote', SavedQuoteSchema)
