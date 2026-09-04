const mongoose = require('mongoose')
const { INVOICE_STATUSES, INVOICE_VALUE_TYPES, PAYMENT_PROOF_STATUSES, PAYMENT_METHODS, INVOICE_TYPES, INVOICE_CATEGORIES } = require('../config/constants')

const PaymentProofFileSchema = new mongoose.Schema(
  { url: { type: String, required: true }, name: { type: String, default: '' } },
  { _id: false }
)
const { computeInvoiceDueDate } = require('../utils/invoiceDueDate')

const LineItemSchema = new mongoose.Schema(
  {
    images:   { type: [String], default: [], validate: { validator: v => v.length <= 4, message: 'Max 4 images per line item' } },
    description: { type: String, default: '' },
    items:    { type: [String], default: [] },
    rate:     { type: Number, default: 0 },
    markup:   { type: Number, default: 0 },
    markupType: {
      type: String,
      enum: INVOICE_VALUE_TYPES,
      default: 'amount',
    },
    quantity: { type: Number, default: 1 },
    tax:      { type: Number, default: 0 },
    taxType: {
      type: String,
      enum: INVOICE_VALUE_TYPES,
      default: 'amount',
    },
    /** Rate after per-unit markup (display / email) */
    effectiveRate: { type: Number, default: 0 },
    /** Total markup dollars for this line (markup per unit × qty) */
    markupAmount: { type: Number, default: 0 },
    /** Computed tax dollars for this line */
    taxAmount: { type: Number, default: 0 },
    /** Line subtotal excluding tax: (effectiveRate × qty) */
    total:    { type: Number, default: 0 },
  },
  { _id: true }
)

const InvoiceApprovalHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['not_submitted', 'pending_approval', 'approved', 'rejected', 'sent'],
      required: true,
    },
    note: { type: String, default: '' },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
)

const InvoiceApprovalSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['not_submitted', 'pending_approval', 'approved', 'rejected'],
      default: 'not_submitted',
    },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submittedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
    approvedRevision: { type: Number, default: null },
    history: { type: [InvoiceApprovalHistorySchema], default: [] },
  },
  { _id: false }
)

const InvoiceSchema = new mongoose.Schema(
  {
    leadId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    // Only required for customer-billing invoices — vendor/freight_carrier invoices are money the
    // company owes out, not a customer receivable, so they have no customer on them.
    customerId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    invoiceType:       { type: String, enum: INVOICE_TYPES, default: 'customer' },
    category:          { type: String, enum: INVOICE_CATEGORIES, default: null },
    vendorId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    carrierId:         { type: mongoose.Schema.Types.ObjectId, ref: 'FreightCarrier', default: null },
    payeeName:         { type: String, default: '', trim: true },
    quotationId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoiceNumber:     { type: String, unique: true },
    description: { type: String, default: '' },
    date:              { type: Date, default: Date.now },
    paymentScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentSchedule', default: null },
    // Links this invoice to a specific stage in a lead-level PaymentSchedule.
    // Null if invoice was not created against a payment schedule stage.
    paymentScheduleStageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    daysToPay:         { type: Number, default: null },
    dueDate:           { type: Date, default: null },
    poNumber:          { type: String, default: '' },

    lineItems:    { type: [LineItemSchema], default: [] },
    subtotal:     { type: Number, default: 0 },
    markupTotal:  { type: Number, default: 0 },
    tax:          { type: Number, default: 0 },
    discount:     { type: Number, default: 0 },
    depositAmount:{ type: Number, default: 0 },
    totalAmount:  { type: Number, default: 0 },

    status:  { type: String, enum: INVOICE_STATUSES, default: 'draft' },
    sentAt:  { type: Date, default: null },
    revision: { type: Number, default: 1 },
    approval: { type: InvoiceApprovalSchema, default: () => ({}) },

    // Mark as paid — stores who did it and when
    paidBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt:  { type: Date, default: null },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: null },

    // Customer-submitted payment receipt review — separate from `status`, since the invoice only
    // flips to 'paid' once admin/sales verifies the proof (see PAYMENT_PROOF_STATUSES).
    paymentProof: {
      status:         { type: String, enum: PAYMENT_PROOF_STATUSES, default: 'none' },
      files:          { type: [PaymentProofFileSchema], default: [] },
      transactionId:  { type: String, default: '', trim: true },
      paymentDate:    { type: Date, default: null },
      amount:         { type: Number, default: null },
      notes:          { type: String, default: '', trim: true },
      submittedAt:    { type: Date, default: null },
      reviewedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt:     { type: Date, default: null },
      reviewNotes:    { type: String, default: '', trim: true },
    },
  },
  { timestamps: true }
)

InvoiceSchema.index({ leadId: 1, createdAt: -1 })
InvoiceSchema.index({ customerId: 1 })

InvoiceSchema.pre('save', function setDueDate(next) {
  this.dueDate = computeInvoiceDueDate(this.date, this.daysToPay)
  next()
})

module.exports = mongoose.model('Invoice', InvoiceSchema)
