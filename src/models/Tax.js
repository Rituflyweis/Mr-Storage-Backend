const mongoose = require('mongoose')

const TAX_STATUSES = ['pending', 'paid']

const TaxSchema = new mongoose.Schema(
  {
    state:       { type: String, required: true, trim: true },
    dueDate:     { type: Date, required: true },
    amount:      { type: Number, required: true },
    websiteLink: { type: String, default: null, trim: true },
    status:      { type: String, enum: TAX_STATUSES, default: 'pending' },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paidBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt:      { type: Date, default: null },
  },
  { timestamps: true }
)

TaxSchema.index({ dueDate: 1 })
TaxSchema.index({ status: 1 })

module.exports = mongoose.model('Tax', TaxSchema)
