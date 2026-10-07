const mongoose = require('mongoose')

const SENDER_TYPES = ['customer', 'admin', 'sales']

const CustomerDirectMessageSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    senderType: { type: String, enum: SENDER_TYPES, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    senderName: { type: String, default: '' },
    content: { type: String, required: true, trim: true },
    isReadByCustomer: { type: Boolean, default: false },
    isReadByStaff: { type: Boolean, default: false },
  },
  { timestamps: true }
)

CustomerDirectMessageSchema.index({ customerId: 1, createdAt: -1 })

module.exports = mongoose.model('CustomerDirectMessage', CustomerDirectMessageSchema)
module.exports.SENDER_TYPES = SENDER_TYPES
