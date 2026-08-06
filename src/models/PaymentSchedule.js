const mongoose = require('mongoose')
const { PAYMENT_AMOUNT_TYPES, PAYMENT_STAGE_STATUSES } = require('../config/constants')

const StageSchema = new mongoose.Schema(
  {
    stageName:  { type: String, required: true },
    amount:     { type: Number, required: true },
    amountType: { type: String, enum: PAYMENT_AMOUNT_TYPES, required: true },
    dueDate:    { type: Date, default: null },
    status:     { type: String, enum: PAYMENT_STAGE_STATUSES, default: 'pending' },
    invoiceId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    paidAt:     { type: Date, default: null },
    paidBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: true }
)

const PaymentScheduleSchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    stages:      { type: [StageSchema], default: [] },
    totalAmount: { type: Number, required: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

PaymentScheduleSchema.index({ customerId: 1 })

module.exports = mongoose.model('PaymentSchedule', PaymentScheduleSchema)
