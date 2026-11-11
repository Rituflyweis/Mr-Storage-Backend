const mongoose = require('mongoose')

const CallTurnSchema = new mongoose.Schema(
  {
    callSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CallSession',
      required: true,
      index: true,
    },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    role: { type: String, enum: ['customer', 'ai', 'system'], required: true },
    transcript: { type: String, required: true, trim: true },
    twilioGatherSid: { type: String, default: '', trim: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  },
  { timestamps: true }
)

CallTurnSchema.index({ callSessionId: 1, createdAt: 1 })

module.exports = mongoose.model('CallTurn', CallTurnSchema)
