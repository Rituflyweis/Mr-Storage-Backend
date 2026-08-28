const mongoose = require('mongoose')

const PRODUCT_CATEGORIES = ['Structure', 'Panels', 'Hardware', 'Trims', 'Opening', 'Accessories']
const PRODUCT_PRICING_TYPES = ['per_lb', 'per_sq_ft', 'per_linear_ft', 'per_qty']
const PRODUCT_STATUSES = ['active', 'inactive', 'draft']
const PRODUCT_USAGE = ['quotation', 'bom_takeoff', 'shipper', 'freight', 'other']

const ProductSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    description:   { type: String, default: '', trim: true },
    category:      { type: String, required: true, enum: PRODUCT_CATEGORIES },
    subcategory:   { type: String, default: '', trim: true },
    skuPartCode:   { type: String, default: '', trim: true },
    vendorShipper: { type: String, default: '', trim: true },
    productImage:  { type: String, default: null },

    // Pricing
    pricingType:     { type: String, enum: PRODUCT_PRICING_TYPES, default: 'per_qty' },
    unit:            { type: String, default: '', trim: true },
    baseCost:        { type: Number, default: 0 },
    defaultMargin:   { type: Number, default: 0 },
    sellingPrice:    { type: Number, default: 0 },
    minMargin:       { type: Number, default: 0 },
    maxMargin:       { type: Number, default: 0 },

    // Quantity
    inputTypeRequired:    { type: String, default: '', trim: true },
    defaultQty:           { type: Number, default: 1 },
    allowQuantityOverride: { type: Boolean, default: true },
    minOrderQuantity:     { type: Number, default: 1 },
    leadTime:             { type: String, default: '', trim: true },
    stockTracking:        { type: Boolean, default: false },

    // Cost breakdown — totalCost is server-computed (materialCost + laborCost + overheadCost)
    materialCost: { type: Number, default: 0 },
    laborCost:    { type: Number, default: 0 },
    overheadCost: { type: Number, default: 0 },
    totalCost:    { type: Number, default: 0 },

    // Tax & Accounting
    taxCategory:  { type: String, default: '', trim: true },
    accountCode:  { type: String, default: '', trim: true },
    taxable:      { type: Boolean, default: true },

    // Usage Mapping
    usageMapping: [{ type: String, enum: PRODUCT_USAGE }],

    // SMDT Integration
    smdtLinkedCode: { type: String, default: null, trim: true },
    smdtLastSynced: { type: Date, default: null },
    smdtSyncSource: { type: String, default: null, trim: true },

    // Control
    status:      { type: String, enum: PRODUCT_STATUSES, default: 'active' },
    effectiveFrom: { type: Date, default: null },
    priceLock:   { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ProductSchema.index({ category: 1 })
ProductSchema.index({ status: 1 })
ProductSchema.index({ skuPartCode: 1 })
ProductSchema.index({ name: 'text', description: 'text' })

module.exports = mongoose.model('Product', ProductSchema)
module.exports.PRODUCT_CATEGORIES = PRODUCT_CATEGORIES
module.exports.PRODUCT_PRICING_TYPES = PRODUCT_PRICING_TYPES
module.exports.PRODUCT_STATUSES = PRODUCT_STATUSES
