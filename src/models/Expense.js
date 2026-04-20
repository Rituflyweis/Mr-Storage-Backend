const mongoose = require('mongoose')

const ExpenseSchema = new mongoose.Schema(
  {
    amountCents:    { type: Number, required: true },
    category:       { type: String, required: true, trim: true },
    description:    { type: String, default: '', trim: true },
    incurredAt:     { type: Date, required: true },
    vendor:         { type: String, default: '', trim: true },
    receiptFileKey: { type: String, default: null },
    leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ExpenseSchema.index({ incurredAt: -1 })
ExpenseSchema.index({ leadId: 1 })
ExpenseSchema.index({ category: 1 })

module.exports = mongoose.model('Expense', ExpenseSchema)
