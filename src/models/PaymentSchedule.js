const mongoose = require('mongoose')
const { PAYMENT_AMOUNT_TYPES, PAYMENT_ITEM_STATUSES } = require('../config/constants')

const PaymentItemSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true },
    amount:     { type: Number, required: true },
    amountType: { type: String, enum: PAYMENT_AMOUNT_TYPES, required: true },
    dueDate:    { type: Date, default: null },
    status:     { type: String, enum: PAYMENT_ITEM_STATUSES, default: 'pending' },
    paidAt:     { type: Date, default: null },
    paidBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true }
)

const PaymentScheduleSchema = new mongoose.Schema(
  {
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    invoiceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, unique: true },
    payments:    { type: [PaymentItemSchema], default: [] },
    totalAmount: { type: Number, required: true },
  },
  { timestamps: true }
)

// invoiceId is already indexed via unique:true

module.exports = mongoose.model('PaymentSchedule', PaymentScheduleSchema)
