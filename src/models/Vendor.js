const mongoose = require('mongoose')
const { VENDOR_STATUSES, VENDOR_TYPES } = require('../config/constants')

const AddressSchema = new mongoose.Schema(
  {
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

const VendorDocumentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url:  { type: String, required: true, trim: true },
  },
  { _id: true }
)

const VendorSchema = new mongoose.Schema(
  {
    vendorCode:       { type: String, unique: true, trim: true },
    vendorName:       { type: String, required: true, trim: true },
    contactName:      { type: String, default: '', trim: true },
    email:            { type: String, required: true, trim: true, lowercase: true },
    phone:            { type: String, default: '', trim: true },
    yearsWithCompany: { type: Number, default: null, min: 0 },
    serviceCategory:  { type: String, default: '', trim: true },
    vendorType:       { type: String, enum: VENDOR_TYPES, default: 'other' },
    materialTypes:    { type: [String], default: [] },
    address:          { type: AddressSchema, default: () => ({}) },
    documents:        { type: [VendorDocumentSchema], default: [] },
    internalNotes:    { type: String, default: '' },
    status:           { type: String, enum: VENDOR_STATUSES, default: 'active' },
  },
  { timestamps: true }
)

VendorSchema.index({ status: 1 })
VendorSchema.index({ email: 1 }, { unique: true })
VendorSchema.index({ vendorName: 1 })
VendorSchema.index({ materialTypes: 1 })

module.exports = mongoose.model('Vendor', VendorSchema)
