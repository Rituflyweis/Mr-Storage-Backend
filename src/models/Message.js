const mongoose = require('mongoose')

const MessageSchema = new mongoose.Schema(
  {
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    senderType: { type: String, enum: ['customer', 'ai', 'sales'], required: true },
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    content:    { type: String, required: true },
    isRead:     { type: Boolean, default: false },
  },
  { timestamps: true }
)

MessageSchema.index({ leadId: 1, createdAt: 1 })

module.exports = mongoose.model('Message', MessageSchema)
