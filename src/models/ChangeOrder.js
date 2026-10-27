const mongoose = require('mongoose')

/**
 * Change Order against a base estimate/quote.
 * Mirrors SM-QuotingTool v7 CO record (attachment saveAndPrintCO L6540-6556).
 */
const ChangeOrderSchema = new mongoose.Schema(
  {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Link to the stored estimate when available; parentQuoteRef keeps the
    // client-side quote id for parity with the MVP's localStorage records.
    estimateQuoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'EstimateQuote', default: null },
    parentQuoteRef: { type: String, default: '' },

    coNum: { type: Number, required: true },
    customer: { type: String, default: '' },
    coDate: { type: String, default: '' },
    origDate: { type: String, default: '' },

    origVal: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    cost: { type: Number, default: null },
    profit: { type: Number, default: null },
    margin: { type: Number, default: null },
    newTotal: { type: Number, default: 0 },

    description: { type: String, default: '' },
    company: { type: String, default: 'SM' },

    employeeName: { type: String, default: '' },
    employeeRole: { type: String, default: '' },
  },
  { timestamps: true },
)

ChangeOrderSchema.index({ estimateQuoteId: 1, coNum: 1 })
ChangeOrderSchema.index({ parentQuoteRef: 1, coNum: 1 })

module.exports = mongoose.model('ChangeOrder', ChangeOrderSchema)
