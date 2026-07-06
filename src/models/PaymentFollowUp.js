const mongoose = require('mongoose')

const PAYMENT_FOLLOWUP_STATUSES = ['pending', 'confirmed', 'notified_to_accounts']

const PaymentFollowUpSchema = new mongoose.Schema(
  {
    invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    leadId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    nextFollowUp:  { type: Date, default: null },
    status:        { type: String, enum: PAYMENT_FOLLOWUP_STATUSES, default: 'pending' },
    notes:         { type: String, default: '' },
  },
  { timestamps: true }
)

module.exports = mongoose.model('PaymentFollowUp', PaymentFollowUpSchema)
