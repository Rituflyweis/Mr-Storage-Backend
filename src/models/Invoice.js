const mongoose = require('mongoose')
const { INVOICE_STATUSES, INVOICE_VALUE_TYPES } = require('../config/constants')
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

const InvoiceSchema = new mongoose.Schema(
  {
    leadId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
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

    // Mark as paid — stores who did it and when
    paidBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt:  { type: Date, default: null },
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
