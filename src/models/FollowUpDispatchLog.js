const mongoose = require('mongoose')

const FollowUpDispatchLogSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['chat_dropoff', 'warm_lead', 'cold_lead', 'invoice_reminder', 'manual_followup', 'meeting_reminder'],
      required: true,
      index: true,
    },
    channel: { type: String, enum: ['sms', 'email'], required: true },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    followUpId: { type: mongoose.Schema.Types.ObjectId, ref: 'FollowUp', default: null, index: true },
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', default: null, index: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentAt: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, default: '' },
  },
  { timestamps: true }
)

FollowUpDispatchLogSchema.index({ kind: 1, leadId: 1, sentAt: -1 })
FollowUpDispatchLogSchema.index({ kind: 1, invoiceId: 1, sentAt: -1 })

module.exports = mongoose.model('FollowUpDispatchLog', FollowUpDispatchLogSchema)
