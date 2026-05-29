const mongoose = require('mongoose')
const { DELIVERY_STATUSES } = require('../config/constants')

const DeliverySchema = new mongoose.Schema(
  {
    leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    deliveryNumber: { type: String, required: true, unique: true, trim: true },
    status:         { type: String, enum: DELIVERY_STATUSES, default: 'draft', index: true },
    pickupLocation:   { type: String, default: '' },
    deliveryLocation: { type: String, default: '' },
    selectedCarrierBidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FreightBid',
      default: null,
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Delivery', DeliverySchema)
