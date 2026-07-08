const mongoose = require('mongoose')
const { DELIVERY_STATUSES } = require('../config/constants')

const CoordinatesSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false }
)

const LocationSchema = new mongoose.Schema(
  {
    address: { type: String, default: '' },
    coordinates: { type: CoordinatesSchema, default: () => ({}) },
  },
  { _id: false }
)

const DimensionsSchema = new mongoose.Schema(
  {
    lengthFeet: { type: Number, default: null },
    widthFeet: { type: Number, default: null },
    heightFeet: { type: Number, default: null },
  },
  { _id: false }
)

const DeliverySchema = new mongoose.Schema(
  {
    statusHistory: {
      type: [
        new mongoose.Schema(
          {
            status: { type: String, enum: DELIVERY_STATUSES, required: true },
            changedAt: { type: Date, default: Date.now },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    deliveryNumber: { type: String, required: true, unique: true, trim: true },
    status:         { type: String, enum: DELIVERY_STATUSES, default: 'draft', index: true },
    description: { type: String, default: '' },
    loadDescription: { type: String, default: '' },
    loadWeight: { type: Number, default: null },
    dimensions: { type: DimensionsSchema, default: () => ({}) },
    materialType: { type: String, default: '' },
    packageCount: { type: Number, default: null },
    loadingEquipment: { type: [String], default: [] },
    bidDeadline: { type: Date, default: null },
    documentUrl: { type: String, default: '' },
    pickupLocation: { type: String, default: '' },
    pickupLocationData: { type: LocationSchema, default: () => ({}) },
    deliveryLocation: { type: String, default: '' },
    deliveryLocationData: { type: LocationSchema, default: () => ({}) },
    pickupDate: { type: Date, default: null },
    pickupTime: { type: String, default: '' },
    deliveryDate: { type: Date, default: null },
    deliveryTime: { type: String, default: '' },
    timeWindowStart: { type: String, default: '' },
    timeWindowEnd: { type: String, default: '' },
    timings: { type: String, default: '' },
    receivingPoc: { type: String, default: '' },
    pickupContactPhone: { type: String, default: '' },
    specialRequirements: { type: String, default: '' },
    additionalNotes: { type: String, default: '' },
    rescheduleHistory: {
      type: [
        new mongoose.Schema(
          {
            date: { type: Date, default: null },
            timeWindowStart: { type: String, default: '' },
            timeWindowEnd: { type: String, default: '' },
            reason: { type: String, default: '' },
            additionalNotes: { type: String, default: '' },
            rescheduledAt: { type: Date, default: Date.now },
            rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    selectedCarrierBidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FreightBid',
      default: null,
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Delivery', DeliverySchema)
