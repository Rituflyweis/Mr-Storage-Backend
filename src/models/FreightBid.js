const mongoose = require('mongoose')
const { FREIGHT_BID_STATUSES } = require('../config/constants')

const FreightBidSchema = new mongoose.Schema(
  {
    deliveryId:            { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
    carrierId:             { type: mongoose.Schema.Types.ObjectId, ref: 'FreightCarrier', required: true, index: true },
    token:                 { type: String, required: true, unique: true },
    status:                { type: String, enum: FREIGHT_BID_STATUSES, default: 'sent', index: true },
    quotedAmount:          { type: Number, default: null },
    currency:              { type: String, default: 'USD' },
    estimatedPickupDate:   { type: Date, default: null },
    estimatedDeliveryDate: { type: Date, default: null },
    carrierNotes:          { type: String, default: '' },
    submittedAt:           { type: Date, default: null },
    sentAt:                { type: Date, default: Date.now },
    expiresAt:             { type: Date, default: null },
    selectedAt:            { type: Date, default: null },
  },
  { timestamps: true }
)

FreightBidSchema.index({ deliveryId: 1, carrierId: 1 }, { unique: true })

module.exports = mongoose.model('FreightBid', FreightBidSchema)
