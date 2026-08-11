const mongoose = require('mongoose')

const OQ_STATUSES = ['sent', 'approved', 'rejected']

const OrderQuotationLineSchema = new mongoose.Schema(
  {
    coilType: { type: String, required: true, trim: true },
    lengthFeet: { type: Number, default: null },
    quantity:  { type: Number, required: true, min: 0 },
    color:     { type: String, default: '', trim: true },
    unitPrice: { type: Number, default: 0 },
    amount:    { type: Number, default: 0 },
  },
  { _id: false }
)

const OrderQuotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, unique: true, trim: true },
    orderId:      { type: mongoose.Schema.Types.ObjectId, ref: 'MaterialRequest', required: true, index: true },
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    customerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    buildingLabel: { type: String, default: '', trim: true },
    sellerName:   { type: String, default: '' },
    sellerAddress: { type: String, default: '' },
    sellerEmail:  { type: String, default: '' },
    lineItems:    [OrderQuotationLineSchema],
    subtotal:     { type: Number, default: 0 },
    tax:          { type: Number, default: 0 },
    freight:      { type: Number, default: 0 },
    totalValue:   { type: Number, default: 0 },
    paymentMethods: { type: [String], default: ['PayPal', 'Visa', 'Mastercard'] },
    status:       { type: String, enum: OQ_STATUSES, default: 'sent' },
    sentAt:       { type: Date, default: Date.now },
    respondedAt:  { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

OrderQuotationSchema.index({ leadId: 1, status: 1 })

module.exports = mongoose.model('OrderQuotation', OrderQuotationSchema)
module.exports.OQ_STATUSES = OQ_STATUSES
