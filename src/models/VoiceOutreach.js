const mongoose = require('mongoose')

const STATUSES = ['scheduled', 'dialing', 'in-progress', 'completed', 'exhausted', 'opted-out']

const VoiceOutreachSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    toNumber: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'America/Chicago', trim: true },
    status: { type: String, enum: STATUSES, default: 'scheduled', index: true },
    attemptCount: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastCallSid: { type: String, default: '', trim: true, index: true },
    lastResult: { type: String, default: '', trim: true },
    voicemailLeft: { type: Boolean, default: false },
    smsSentAt: { type: Date, default: null },
    reachedAt: { type: Date, default: null },
    source: { type: String, default: 'inquiry', trim: true },
  },
  { timestamps: true },
)

VoiceOutreachSchema.index({ status: 1, nextAttemptAt: 1 })

module.exports = mongoose.model('VoiceOutreach', VoiceOutreachSchema)
module.exports.VOICE_OUTREACH_STATUSES = STATUSES
