const mongoose = require('mongoose')

const WIP_STATUSES = ['in_progress', 'started', 'completed', 'on_hold']

const WIPProfitSchema = new mongoose.Schema(
  {
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    orderValue:   { type: Number, default: 0 },
    currentCost:  { type: Number, default: 0 },
    depositPaid:  { type: Number, default: 0 },
    progressPaid: { type: Number, default: 0 },
    finalPaid:    { type: Number, default: 0 },
    outstanding:  { type: Number, default: 0 },
    wipProfit:    { type: Number, default: 0 },
    marginPct:    { type: Number, default: 0 },
    status:       { type: String, enum: WIP_STATUSES, default: 'in_progress' },
    notes:        { type: String, default: '', trim: true },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

WIPProfitSchema.index({ createdAt: -1 })

module.exports = mongoose.model('WIPProfit', WIPProfitSchema)
module.exports.WIP_STATUSES = WIP_STATUSES
