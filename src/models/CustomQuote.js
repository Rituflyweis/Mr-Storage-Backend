const mongoose = require('mongoose')

/**
 * Free-form custom quote (non-shipper) — port of SM-QuotingTool v7 Custom Quote page
 * (attachment renderCustomQuote L8746). Pricing: sell = sellOverride || totalCost/(1-margin).
 */
const CustomQuoteSchema = new mongoose.Schema(
  {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

    customer: { type: String, default: '' },
    location: { type: String, default: '' },
    size: { type: String, default: '' },
    scope: { type: String, default: 'both' },
    expDays: { type: Number, default: 15 },

    matCost: { type: Number, default: 0 },
    freight: { type: Number, default: 0 },
    laborCost: { type: Number, default: 0 },
    marginPct: { type: Number, default: 20 },
    sellOverride: { type: Number, default: null },

    // computed snapshot
    totalCost: { type: Number, default: 0 },
    sell: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    profPct: { type: Number, default: 0 },

    inclusions: { type: [String], default: [] },
    exclusions: { type: [String], default: [] },
    sow: {
      overview: { type: String, default: '' },
      delivery: { type: String, default: '' },
      terms: { type: String, default: '' },
    },
    additional: { type: String, default: '' },

    company: { type: String, default: 'SM' },
    status: { type: String, default: 'Draft' },
    employeeName: { type: String, default: '' },
    employeeRole: { type: String, default: '' },
  },
  { timestamps: true },
)

module.exports = mongoose.model('CustomQuote', CustomQuoteSchema)
