const mongoose = require('mongoose')
const { CARRIER_STATUSES } = require('../config/constants')

const AddressSchema = new mongoose.Schema(
  {
    country:       { type: String, default: '' },
    placeNumber:   { type: String, default: '' },
    streetAddress: { type: String, default: '' },
    landmark:      { type: String, default: '' },
    city:          { type: String, default: '' },
    state:         { type: String, default: '' },
    postalCode:    { type: String, default: '' },
    gpsCoordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
  },
  { _id: false }
)

const CarrierDocumentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url:  { type: String, required: true, trim: true },
  },
  { _id: true }
)

const FleetEquipmentSchema = new mongoose.Schema(
  {
    equipmentName: { type: String, required: true, trim: true },
    quantity:      { type: Number, default: 1, min: 0 },
  },
  { _id: true }
)

const FleetCapacitySchema = new mongoose.Schema(
  {
    totalVehicleCount:   { type: Number, default: null, min: 0 },
    maximumLoadCapacity: { type: Number, default: null, min: 0 },
    averageFleetAge:     { type: Number, default: null, min: 0 },
  },
  { _id: false }
)

const FreightCarrierSchema = new mongoose.Schema(
  {
    carrierCode:    { type: String, unique: true, trim: true },
    carrierName:    { type: String, required: true, trim: true },
    contactName:    { type: String, default: '', trim: true },
    email:          { type: String, required: true, trim: true, lowercase: true },
    phone:          { type: String, default: '', trim: true },
    serviceType:    { type: String, default: '', trim: true },
    serviceArea:    { type: String, default: '', trim: true },
    address:        { type: AddressSchema, default: () => ({}) },
    fleetEquipment: { type: [FleetEquipmentSchema], default: [] },
    fleetCapacity:  { type: FleetCapacitySchema, default: () => ({}) },
    documents:      { type: [CarrierDocumentSchema], default: [] },
    internalNotes:  { type: String, default: '' },
    status:         { type: String, enum: CARRIER_STATUSES, default: 'active' },
  },
  { timestamps: true }
)

FreightCarrierSchema.index({ status: 1 })
FreightCarrierSchema.index({ email: 1 }, { unique: true })
FreightCarrierSchema.index({ carrierName: 1 })
FreightCarrierSchema.index({ serviceType: 1 })
FreightCarrierSchema.index({ serviceArea: 1 })
FreightCarrierSchema.index({ 'fleetEquipment.equipmentName': 1 })

module.exports = mongoose.model('FreightCarrier', FreightCarrierSchema)
