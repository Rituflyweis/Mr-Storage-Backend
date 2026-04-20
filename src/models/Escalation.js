const mongoose = require('mongoose')
const { ESCALATION_STATUSES } = require('../config/constants')

const EscalationSchema = new mongoose.Schema(
  {
    leadId:             { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    raisedBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    note:               { type: String, required: true, trim: true },
    status:             { type: String, enum: ESCALATION_STATUSES, default: 'pending' },
    resolvedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAssignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt:         { type: Date, default: null },
  },
  { timestamps: true }
)

EscalationSchema.index({ status: 1, createdAt: -1 })
EscalationSchema.index({ leadId: 1 })

module.exports = mongoose.model('Escalation', EscalationSchema)
