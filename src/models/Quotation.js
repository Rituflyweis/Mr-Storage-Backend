const mongoose = require('mongoose')
const { QUOTATION_STATUSES, PRIORITY_LEVELS } = require('../config/constants')

const QuotationSchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    buildingType:      { type: String, default: '' },
    basePrice:         { type: Number, default: 0 },
    maxPrice:          { type: Number, default: 0 },
    sqft:              { type: String, default: '' },
    width:             { type: Number, default: null },
    length:            { type: Number, default: null },
    height:            { type: Number, default: null },
    currency:          { type: String, default: 'USD' },
    roofStyle:         { type: String, default: '' },
    validTill:         { type: Date, default: null },
    location:          { type: String, default: '' },
    windLoad:          { type: String, default: '' },
    snowLoad:          { type: String, default: '' },
    paymentTerms:      { type: String, default: '' },
    companyName:       { type: String, default: '' },
    estimatedDelivery: { type: String, default: '' },

    includedMaterials: [
      {
        name:        { type: String },
        description: { type: String },
        quantity:    { type: Number },
      },
    ],

    optionalAddOns: [
      {
        name:        { type: String },
        description: { type: String },
        price:       { type: Number },
      },
    ],

    specialNote:   { type: String, default: '' },
    internalNotes: { type: String, default: '' },
    priorityLevel: { type: String, enum: PRIORITY_LEVELS, default: 'medium' },
    status:        { type: String, enum: QUOTATION_STATUSES, default: 'draft' },
    sentAt:        { type: Date, default: null },
  },
  { timestamps: true }
)

QuotationSchema.index({ leadId: 1, createdAt: -1 })

module.exports = mongoose.model('Quotation', QuotationSchema)
