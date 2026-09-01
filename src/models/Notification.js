const mongoose = require('mongoose')

const NOTIFICATION_TYPES = [
  'lead', 'task', 'meeting', 'escalation', 'payment', 'system', 'drawing', 'delivery', 'followup',
  'material_request', 'quotation', 'invoice', 'freight_bid', 'chat',
]
const NOTIFICATION_PRIORITIES = ['high', 'medium', 'low']

const NotificationSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
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
NotificationSchema.index({ customerId: 1, createdAt: -1 })

module.exports = mongoose.model('Notification', NotificationSchema)
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES
module.exports.NOTIFICATION_PRIORITIES = NOTIFICATION_PRIORITIES
