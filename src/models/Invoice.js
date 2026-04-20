const mongoose = require('mongoose')
const { INVOICE_STATUSES } = require('../config/constants')

const LineItemSchema = new mongoose.Schema(
  {
    images:   { type: [String], default: [], validate: { validator: v => v.length <= 4, message: 'Max 4 images per line item' } },
    items:    { type: [String], default: [] },
    rate:     { type: Number, default: 0 },
    markup:   { type: Number, default: 0 },
    quantity: { type: Number, default: 1 },
    tax:      { type: Number, default: 0 },
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

    date:              { type: Date, default: Date.now },
    paymentScheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentSchedule', default: null },
    daysToPay:         { type: Number, default: null },
    poNumber:          { type: String, default: '' },

    lineItems:    { type: [LineItemSchema], default: [] },
    subtotal:     { type: Number, default: 0 },
    markupTotal:  { type: Number, default: 0 },
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

module.exports = mongoose.model('Invoice', InvoiceSchema)
