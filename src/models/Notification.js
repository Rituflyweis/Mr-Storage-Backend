const mongoose = require('mongoose')

const NOTIFICATION_TYPES = ['lead', 'task', 'meeting', 'escalation', 'payment', 'system']
const NOTIFICATION_PRIORITIES = ['high', 'medium', 'low']

const NotificationSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title:     { type: String, required: true, trim: true },
    body:      { type: String, default: '' },
    type:      { type: String, enum: NOTIFICATION_TYPES, default: 'system' },
    priority:  { type: String, enum: NOTIFICATION_PRIORITIES, default: 'medium' },
    isRead:    { type: Boolean, default: false, index: true },
    refId:     { type: mongoose.Schema.Types.ObjectId, default: null },
    refModel:  { type: String, default: null },
  },
  { timestamps: true }
)

NotificationSchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('Notification', NotificationSchema)
