const mongoose = require('mongoose')

const CALL_SESSION_STATUSES = ['in-progress', 'completed', 'failed', 'no-answer', 'busy', 'canceled']

const CallSessionSchema = new mongoose.Schema(
  {
    twilioCallSid: { type: String, required: true, unique: true, trim: true, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
    fromNumber: { type: String, default: '', trim: true },
    toNumber: { type: String, default: '', trim: true },
    status: { type: String, enum: CALL_SESSION_STATUSES, default: 'in-progress', index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: null },
    isHandedToSales: { type: Boolean, default: false },
    /** True when customer was created from this call and name/email still pending. */
    needsContactDetails: { type: Boolean, default: false },
    /** @deprecated unknown callers are now onboarded on-call; kept for old rows */
    unknownCaller: { type: Boolean, default: false },
    lastSpeechFingerprint: { type: String, default: '' },
    /** Consecutive empty Gather results — re-prompt then hang up. */
    emptyGatherCount: { type: Number, default: 0 },
  },
  { timestamps: true }
)

CallSessionSchema.index({ leadId: 1, createdAt: -1 })

module.exports = mongoose.model('CallSession', CallSessionSchema)
module.exports.CALL_SESSION_STATUSES = CALL_SESSION_STATUSES
