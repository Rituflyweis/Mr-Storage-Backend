const mongoose = require('mongoose')

/**
 * tax_transactions (spec §6 Table 3, §1/§10 "preserve all transaction inputs and
 * AvaTax responses for reconciliation"). One row per AvaTax document code, updated
 * across its lifecycle (create -> commit -> adjust/void). Request/response/error
 * payloads are retained; no secrets are stored (auth lives only in request headers).
 */
const TaxTransactionSchema = new mongoose.Schema(
  {
    internal_document_id: { type: String, required: true, index: true }, // invoice _id
    document_code: { type: String, required: true, index: true },
    avalara_transaction_id: { type: String, default: '' },
    transaction_type: { type: String, default: '' }, // SalesOrder | SalesInvoice
    status: { type: String, default: '' }, // Saved | Committed | Adjusted | Voided | error
    amount: { type: Number, default: 0 },
    total_tax: { type: Number, default: 0 },
    correlationId: { type: String, default: '' },
    request_json: { type: mongoose.Schema.Types.Mixed, default: null },
    response_json: { type: mongoose.Schema.Types.Mixed, default: null },
    error_json: { type: mongoose.Schema.Types.Mixed, default: null },
    calculated_at: { type: Date, default: null },
    committed_at: { type: Date, default: null },
  },
  { timestamps: true }
)

TaxTransactionSchema.index({ internal_document_id: 1, document_code: 1 }, { unique: true })

module.exports = mongoose.model('TaxTransaction', TaxTransactionSchema)
