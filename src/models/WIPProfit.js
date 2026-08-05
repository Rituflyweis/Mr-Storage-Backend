const mongoose = require('mongoose')

const WIP_STATUSES = ['in_progress', 'started', 'completed', 'on_hold']
const PAYMENT_ENTRY_TYPES = ['deposit', 'progress', 'final']

const PaymentEntrySchema = new mongoose.Schema(
  {
    payerName:     { type: String, default: '', trim: true },
    paymentType:   { type: String, enum: PAYMENT_ENTRY_TYPES, required: true },
    amount:        { type: Number, required: true },
    paymentDate:   { type: Date, required: true },
    transactionId: { type: String, default: '', trim: true },
    remarks:       { type: String, default: '', trim: true },
    recordedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    recordedAt:    { type: Date, default: Date.now },
  },
  { _id: true }
)

const WIPProfitSchema = new mongoose.Schema(
  {
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    orderValue:   { type: Number, default: 0 },
    currentCost:  { type: Number, default: 0 },
    depositPaid:  { type: Number, default: 0 },
    progressPaid: { type: Number, default: 0 },
    finalPaid:    { type: Number, default: 0 },
    outstanding:  { type: Number, default: 0 },
    wipProfit:    { type: Number, default: 0 },
    marginPct:    { type: Number, default: 0 },
    status:       { type: String, enum: WIP_STATUSES, default: 'in_progress' },
    notes:        { type: String, default: '', trim: true },
    payments:     { type: [PaymentEntrySchema], default: [] },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

WIPProfitSchema.index({ createdAt: -1 })

module.exports = mongoose.model('WIPProfit', WIPProfitSchema)
module.exports.WIP_STATUSES = WIP_STATUSES
module.exports.PAYMENT_ENTRY_TYPES = PAYMENT_ENTRY_TYPES
