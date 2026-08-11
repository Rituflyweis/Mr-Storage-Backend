const mongoose = require('mongoose')
const { QUOTATION_STATUSES, PRIORITY_LEVELS } = require('../config/constants')

const QuotationSchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Project header
    quoteNumber:         { type: String, default: '' },
    proposalDate:        { type: Date, default: Date.now },
    validity:            { type: String, default: '' },
    preparedBy:          { type: String, default: '' },
    assignedSalesperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    margin:              { type: Number, default: 0 },

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

    // Detailed building specs
    leftEaveHeight:  { type: Number, default: null },
    rightEaveHeight: { type: Number, default: null },
    roofSlope:       { type: String, default: '' },
    totalArea:       { type: Number, default: null },

    // Structure & engineering
    frameType:   { type: String, default: '' },
    endwallType: { type: String, default: '' },
    girtType:    { type: String, default: '' },
    purlinType:  { type: String, default: '' },
    bracingType: { type: String, default: '' },

    // Material specifications
    roofPanel:     { type: String, default: '' },
    wallPanelType: { type: String, default: '' },
    roofColor:     { type: String, default: '' },
    wallColor:     { type: String, default: '' },
    trimColor:     { type: String, default: '' },
    baseAngle:     { type: String, default: '' },

    // Insulation
    insulation: [
      {
        insulationType: { type: String, enum: ['roof', 'wall'], required: true },
        thickness:      { type: String, default: '' },
        material:       { type: String, default: '' },
      },
    ],

    // Freight / shipping
    shippingCost:     { type: Number, default: 0 },
    deliveryType:     { type: String, default: '' },
    shippingIncluded: { type: Boolean, default: false },

    // COGS + pricing
    materialCost:  { type: Number, default: 0 },
    freightCost:   { type: Number, default: 0 },
    totalCOGS:     { type: Number, default: 0 },
    markupPercent: { type: Number, default: 0 },
    markupValue:   { type: Number, default: 0 },
    finalPrice:    { type: Number, default: 0 },
    psf:           { type: Number, default: null },

    // Doors
    doors: [
      {
        doorCategory: { type: String, enum: ['rolling', 'personnel'], required: true },
        doorType:     { type: String, default: '' },
        size:         { type: String, default: '' },
        qty:          { type: Number, default: 1 },
        notes:        { type: String, default: '' },
      },
    ],

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

    includedComponents: { type: [String], default: [] },
    exclusions:         { type: [String], default: [] },

    specialNote:   { type: String, default: '' },
    internalNotes: { type: String, default: '' },
    clientNotes:   { type: String, default: '' },
    priorityLevel: { type: String, enum: PRIORITY_LEVELS, default: 'medium' },
    status:        { type: String, enum: QUOTATION_STATUSES, default: 'draft' },
    sentAt:        { type: Date, default: null },

    // Versioning
    versionNumber: { type: Number, default: 1 },
    changeNote:    { type: String, default: '' },
  },
  { timestamps: true }
)

QuotationSchema.index({ leadId: 1, createdAt: -1 })
QuotationSchema.index({ createdBy: 1 })
QuotationSchema.index({ status: 1 })

module.exports = mongoose.model('Quotation', QuotationSchema)
