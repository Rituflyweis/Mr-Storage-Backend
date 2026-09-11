const mongoose = require('mongoose')

const EmailSendJobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['quotation', 'invoice'], required: true, index: true },
    resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    errorMessage: { type: String, default: null },
    processingStartedAt: { type: Date, default: null },
    processingEndedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

EmailSendJobSchema.index({ type: 1, resourceId: 1, createdAt: -1 })

module.exports = mongoose.model('EmailSendJob', EmailSendJobSchema)
