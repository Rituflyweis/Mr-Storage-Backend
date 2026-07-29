const mongoose = require('mongoose')

const MessageSchema = new mongoose.Schema(
  {
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    senderType: { type: String, enum: ['customer', 'ai', 'sales', 'admin'], required: true },
    senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    channel:    { type: String, enum: ['project', 'finance', 'construction'], default: 'project' },
    senderName: { type: String, default: '' },
    content:    { type: String, required: true },
    isRead:     { type: Boolean, default: false },
  },
  { timestamps: true }
)

MessageSchema.index({ leadId: 1, createdAt: 1 })

module.exports = mongoose.model('Message', MessageSchema)
