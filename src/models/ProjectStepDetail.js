const mongoose = require('mongoose')

const STEP_KEYS = ['design', 'fabrication', 'dispatch', 'install', 'complete']

const AttachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    url:  { type: String, required: true, trim: true },
  },
  { _id: false }
)

// One record per (leadId, stepKey) — overlay of descriptive detail on top of the
// projectSteps status/date that's always computed from Lead.lifecycleStatus/lifecycleHistory.
// This model never decides completed/in_progress/pending itself; it only supplies the
// extra human-facing fields the "Current Step Details" panel needs.
const ProjectStepDetailSchema = new mongoose.Schema(
  {
    leadId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    stepKey: { type: String, enum: STEP_KEYS, required: true },

    startedBy:   { type: String, default: '', trim: true },
    startedAt:   { type: Date, default: null },
    completedBy: { type: String, default: '', trim: true },
    completedAt: { type: Date, default: null },

    currentStage:       { type: String, default: '', trim: true },
    completionPct:      { type: Number, default: null, min: 0, max: 100 },
    expectedCompletion: { type: Date, default: null },
    notes:              { type: String, default: '', trim: true },
    attachments:         [AttachmentSchema],

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

ProjectStepDetailSchema.index({ leadId: 1, stepKey: 1 }, { unique: true })

module.exports = mongoose.model('ProjectStepDetail', ProjectStepDetailSchema)
module.exports.STEP_KEYS = STEP_KEYS
