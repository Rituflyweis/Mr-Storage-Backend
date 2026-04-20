const mongoose = require('mongoose')
const { PRIORITY_LEVELS, FOLLOW_UP_STATUSES } = require('../config/constants')

const FollowUpSchema = new mongoose.Schema(
  {
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    assignedTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    followUpDate: { type: Date, required: true },
    notes:        { type: String, default: '' },
    priority:     { type: String, enum: PRIORITY_LEVELS, default: 'medium' },
    // 'overdue' is NOT stored — computed at read time:
    // followUpDate < now AND status === 'pending'  →  treat as overdue
    status:       { type: String, enum: FOLLOW_UP_STATUSES, default: 'pending' },
    completedAt:  { type: Date, default: null },
  },
  { timestamps: true }
)

FollowUpSchema.index({ assignedTo: 1, followUpDate: 1 })
FollowUpSchema.index({ leadId: 1 })

module.exports = mongoose.model('FollowUp', FollowUpSchema)
