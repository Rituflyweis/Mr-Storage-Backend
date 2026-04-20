const mongoose = require('mongoose')

const QuoteSummarySchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', required: true },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    summary:     { type: String, required: true },
    generatedAt: { type: Date, default: Date.now },
  }
)

QuoteSummarySchema.index({ quotationId: 1 })

module.exports = mongoose.model('QuoteSummary', QuoteSummarySchema)
