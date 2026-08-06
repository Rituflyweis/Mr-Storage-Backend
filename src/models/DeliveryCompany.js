const mongoose = require('mongoose')

const DELIVERY_COMPANY_STATUSES = ['active', 'inactive']

const AddressSchema = new mongoose.Schema(
  {
    placeNumber:   { type: String, default: '' },
    streetAddress: { type: String, default: '' },
    landmark:      { type: String, default: '' },
    city:          { type: String, default: '' },
    state:         { type: String, default: '' },
    postalCode:    { type: String, default: '' },
  },
  { _id: false }
)

const DeliveryCompanySchema = new mongoose.Schema(
  {
    companyCode:  { type: String, required: true, unique: true, trim: true },
    companyName:  { type: String, required: true, trim: true },
    contactName:  { type: String, default: '', trim: true },
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:        { type: String, default: '', trim: true },
    serviceType:  { type: String, default: '', trim: true },
    address:      { type: AddressSchema, default: () => ({}) },
    internalNotes:{ type: String, default: '', trim: true },
    status:       { type: String, enum: DELIVERY_COMPANY_STATUSES, default: 'active' },
  },
  { timestamps: true }
)

DeliveryCompanySchema.index({ status: 1 })

module.exports = mongoose.model('DeliveryCompany', DeliveryCompanySchema)
module.exports.DELIVERY_COMPANY_STATUSES = DELIVERY_COMPANY_STATUSES
