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
    receivingPocEmail: { type: String, default: '' },
    specialRequirements: { type: String, default: '' },
    additionalNotes: { type: String, default: '' },
    rescheduleHistory: {
      type: [
        new mongoose.Schema(
          {
            previousDate: { type: Date, default: null },
            date: { type: Date, default: null },
            timeWindowStart: { type: String, default: '' },
            timeWindowEnd: { type: String, default: '' },
            reason: { type: String, default: '' },
            additionalNotes: { type: String, default: '' },
            rescheduledAt: { type: Date, default: Date.now },
            rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            acknowledged: { type: Boolean, default: false },
            acknowledgedAt: { type: Date, default: null },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    confirmationEmailSent:   { type: Boolean, default: false },
    confirmationEmailSentAt: { type: Date, default: null },
    selectedCarrierBidId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FreightBid',
      default: null,
    },
    siteContact: {
      contactName: { type: String, default: '' },
      contactTitle: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
      availableHours: { type: String, default: '' },
      notes: { type: String, default: '' },
    },
    siteReadyConfirmation: {
      confirmed: { type: Boolean, default: false },
      confirmedAt: { type: Date, default: null },
      confirmedBy: { type: String, default: '' },
      checklist: {
        siteCleared: { type: Boolean, default: false },
        accessRouteAvailable: { type: Boolean, default: false },
        safetyMeasuresInPlace: { type: Boolean, default: false },
        personnelReady: { type: Boolean, default: false },
      },
    },
    equipmentConfirmation: {
      confirmed: { type: Boolean, default: false },
      confirmedAt: { type: Date, default: null },
      checklist: {
        forkliftAvailable: { type: Boolean, default: false },
        craneOrHeavyMachineryAvailable: { type: Boolean, default: false },
        storageAreaReady: { type: Boolean, default: false },
        toolsAndAccessoriesOnSite: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Delivery', DeliverySchema)
