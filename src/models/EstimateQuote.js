const mongoose = require('mongoose')

const JOB_TYPES = ['PEMB', 'Storage']
const SCOPES = ['Supply', 'Install', 'Both']
const ESTIMATE_STATUSES = ['draft', 'final']

const WeightByCategorySchema = new mongoose.Schema(
  {
    category:  { type: String, required: true },
    weightLbs: { type: Number, default: 0 },
    rate:      { type: Number, default: 0 },
    price:     { type: Number, default: 0 },
    notes:     { type: String, default: '' },
  },
  { _id: false }
)

// PEMB / Storage COG-sheet style estimate — built from an uploaded shipper/BOM file (weight-by-category)
// plus pricing-rules rates, distinct from the simpler manual `Quotation` model.
const EstimateQuoteSchema = new mongoose.Schema(
  {
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leadId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

    jobType:  { type: String, enum: JOB_TYPES, default: 'PEMB' },
    scope:    { type: String, enum: SCOPES, default: 'Both' },
    roofType: { type: String, default: '' },

    leadCompanyName: { type: String, default: '' },
    customerEmail:   { type: String, default: '' },
    streetAddress:   { type: String, default: '' },
    cityStateZip:    { type: String, default: '' },
    buildingSize:    { type: String, default: '' },
    squareFootage:   { type: Number, default: 0 },
    jobNumber:       { type: String, default: '' },
    quoteDate:       { type: Date, default: Date.now },

    installCostPerSf: { type: Number, default: 0 },
    sellPerSf:        { type: Number, default: 0 },

    sourceFileName: { type: String, default: '' },
    extractedDrawingFields: { type: mongoose.Schema.Types.Mixed, default: null },
    blendPct: { type: Number, default: 50 },
    installLevel: { type: String, default: 'medium' },

    parsedCategories: { type: mongoose.Schema.Types.Mixed, default: null },
    tabSummary: { type: [mongoose.Schema.Types.Mixed], default: [] },
    breakdownRows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    pricingResult: { type: mongoose.Schema.Types.Mixed, default: null },
    storageData: { type: mongoose.Schema.Types.Mixed, default: null },
    storagePricingResult: { type: mongoose.Schema.Types.Mixed, default: null },

    concreteAddon: { type: mongoose.Schema.Types.Mixed, default: null },
    insulationAddon: { type: mongoose.Schema.Types.Mixed, default: null },
    salesTax: { type: mongoose.Schema.Types.Mixed, default: null },
    cogsOverride: { type: mongoose.Schema.Types.Mixed, default: null },
    marginOverride: { type: mongoose.Schema.Types.Mixed, default: null },
    contractDetails: { type: mongoose.Schema.Types.Mixed, default: null },
    drawingAttachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
    additionalInfo: { type: String, default: '' },
    fullQuoteResult: { type: mongoose.Schema.Types.Mixed, default: null },

    weightByCategory: { type: [WeightByCategorySchema], default: [] },
    totalWeightLbs:   { type: Number, default: 0 },
    trucksRequired:   { type: Number, default: 0 },

    materialCost: { type: Number, default: 0 },
    freightCost:  { type: Number, default: 0 },
    totalCOGS:    { type: Number, default: 0 },
    installCost:  { type: Number, default: 0 },
    totalSell:    { type: Number, default: 0 },
    profit:       { type: Number, default: 0 },
    marginPercent: { type: Number, default: 0 },
    pricePerSf:    { type: Number, default: null },
    vendorBlendSavings: { type: Number, default: 0 },

    statementOfWork: { type: [String], default: [] },
    exclusions:      { type: [String], default: [] },

    status: { type: String, enum: ESTIMATE_STATUSES, default: 'draft' },
  },
  { timestamps: true }
)

EstimateQuoteSchema.index({ createdBy: 1, createdAt: -1 })
EstimateQuoteSchema.index({ leadId: 1 })

module.exports = mongoose.model('EstimateQuote', EstimateQuoteSchema)
module.exports.JOB_TYPES = JOB_TYPES
module.exports.SCOPES = SCOPES
module.exports.ESTIMATE_STATUSES = ESTIMATE_STATUSES
