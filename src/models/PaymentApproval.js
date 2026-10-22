const mongoose = require('mongoose')

const APPROVAL_STATUSES = ['pending', 'under_review', 'approved', 'disputed', 'rejected']
const PAYMENT_CATEGORIES = ['vendor_payment', 'shipper_payment', 'equipment', 'other_expenses']
const PAYEE_TYPES = ['vendor', 'shipper', 'department', 'carrier', 'delivery_company']
const LINKED_TYPES = ['delivery', 'freight_bid']

const PaymentApprovalRemarkSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

const PaymentApprovalAttachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    url: { type: String, required: true, trim: true },
    fileSize: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

const PaymentApprovalActivitySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, required: true, trim: true },
    label: { type: String, default: '', trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
)

const PaymentApprovalSchema = new mongoose.Schema(
  {
    paymentId:    { type: String, required: true, unique: true, trim: true },
    payee:        { type: String, required: true, trim: true },
    payeeType:    { type: String, enum: PAYEE_TYPES, default: 'vendor' },
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

    // Invoice Management view (Vendor/Carrier/Delivery Company sub-tabs)
    invoiceNumber: { type: String, default: '', trim: true },
    dueDate:       { type: Date, default: null },
    linkedType:    { type: String, enum: LINKED_TYPES, default: null },
    linkedId:      { type: mongoose.Schema.Types.ObjectId, default: null },
    paidAt:        { type: Date, default: null },

    remarks:      { type: [PaymentApprovalRemarkSchema], default: [] },
    attachments:  { type: [PaymentApprovalAttachmentSchema], default: [] },
    activityLog:  { type: [PaymentApprovalActivitySchema], default: [] },
  },
  { timestamps: true }
)

PaymentApprovalSchema.index({ status: 1 })
PaymentApprovalSchema.index({ requestedBy: 1 })
PaymentApprovalSchema.index({ createdAt: -1 })
PaymentApprovalSchema.index({ payeeType: 1 })

module.exports = mongoose.model('PaymentApproval', PaymentApprovalSchema)
module.exports.APPROVAL_STATUSES = APPROVAL_STATUSES
module.exports.PAYEE_TYPES = PAYEE_TYPES
module.exports.PAYMENT_CATEGORIES = PAYMENT_CATEGORIES
