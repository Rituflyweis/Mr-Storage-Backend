const mongoose = require('mongoose')

const MessageSchema = new mongoose.Schema(
  {
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    senderType: { type: String, enum: ['customer', 'ai', 'sales', 'admin'], required: true },
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    channel:    { type: String, enum: ['project', 'finance', 'construction'], default: 'project' },
    /** chat widget vs AI phone call — shared Claude memory across both */
    origin:     { type: String, enum: ['chat', 'call', 'messenger', 'meta_lead'], default: 'chat', index: true },
    /** Facebook message id, so a retried webhook does not reply twice. */
    facebookMid: { type: String },
    callSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CallSession',
      default: null,
      index: true,
    },
    senderName: { type: String, default: '' },
    content:    { type: String, required: true },
    isRead:     { type: Boolean, default: false },
  },
  { timestamps: true }
)

MessageSchema.index({ leadId: 1, createdAt: 1 })
MessageSchema.index({ facebookMid: 1 }, { unique: true, sparse: true })

module.exports = mongoose.model('Message', MessageSchema)
