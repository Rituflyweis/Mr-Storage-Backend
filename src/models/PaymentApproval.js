const mongoose = require('mongoose')

const APPROVAL_STATUSES = ['pending', 'approved', 'rejected']
const PAYMENT_CATEGORIES = ['vendor_payment', 'shipper_payment', 'equipment', 'other_expenses']

const PaymentApprovalSchema = new mongoose.Schema(
  {
    paymentId:    { type: String, required: true, unique: true, trim: true },
    payee:        { type: String, required: true, trim: true },
    payeeType:    { type: String, enum: ['vendor', 'shipper', 'department'], default: 'vendor' },
    category:     { type: String, enum: PAYMENT_CATEGORIES, required: true },
    amount:       { type: Number, required: true },
    requestedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    department:   { type: String, default: '', trim: true },
    notes:        { type: String, default: '', trim: true },
    status:       { type: String, enum: APPROVAL_STATUSES, default: 'pending' },
    reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:   { type: Date, default: null },
    reviewNotes:  { type: String, default: '', trim: true },
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  },
  { timestamps: true }
)

PaymentApprovalSchema.index({ status: 1 })
PaymentApprovalSchema.index({ requestedBy: 1 })
PaymentApprovalSchema.index({ createdAt: -1 })

module.exports = mongoose.model('PaymentApproval', PaymentApprovalSchema)
