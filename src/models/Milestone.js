const mongoose = require('mongoose')

const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed']

const MilestoneSchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    title:       { type: String, required: true, trim: true },
    status:      { type: String, enum: MILESTONE_STATUSES, default: 'pending' },
    targetDate:  { type: Date, default: null },
    completedAt: { type: Date, default: null },
    order:       { type: Number, default: 0 },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

MilestoneSchema.index({ leadId: 1, order: 1 })

module.exports = mongoose.model('Milestone', MilestoneSchema)
module.exports.MILESTONE_STATUSES = MILESTONE_STATUSES
