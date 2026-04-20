const mongoose = require('mongoose')
const { PO_STATUSES } = require('../config/constants')

const POOrderSchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    raisedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoiceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    quotationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', required: true },
    poNumber:    { type: String, required: true, trim: true },
    status:      { type: String, enum: PO_STATUSES, default: 'pending' },
    adminNotes:  { type: String, default: '' },
  },
  { timestamps: true }
)

POOrderSchema.index({ status: 1, createdAt: -1 })
POOrderSchema.index({ raisedBy: 1 })

module.exports = mongoose.model('POOrder', POOrderSchema)
