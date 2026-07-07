const mongoose = require('mongoose')

const CHANNEL_TYPES = ['department', 'direct']

const ChatMessageSchema = new mongoose.Schema(
  {
    channelType:   { type: String, enum: CHANNEL_TYPES, required: true },
    channelName:   { type: String, default: '', trim: true },
    senderId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    content:       { type: String, required: true, trim: true },
    isRead:        { type: Boolean, default: false },
    readAt:        { type: Date, default: null },
  },
  { timestamps: true }
)

ChatMessageSchema.index({ channelType: 1, channelName: 1, createdAt: 1 })
ChatMessageSchema.index({ senderId: 1, recipientId: 1, createdAt: 1 })

module.exports = mongoose.model('ChatMessage', ChatMessageSchema)
module.exports.CHANNEL_TYPES = CHANNEL_TYPES
