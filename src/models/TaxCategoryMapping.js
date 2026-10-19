const mongoose = require('mongoose')

/**
 * tax_category_mappings (spec §6 Table 3).
 * Item -> Avalara tax-code mapping, editable and auditable WITHOUT code changes.
 * Codes are NOT invented here: new categories ship as DRAFT with a null code
 * until the client/accountant approves an official Avalara tax code (§4, §12).
 */
const ITEM_TYPES = ['PRODUCT', 'SERVICE']
const APPROVAL_STATUSES = ['DRAFT', 'PENDING', 'APPROVED']

// The 11 client categories (spec §4 Table 1). backend_category is the stable key.
const BACKEND_CATEGORIES = [
  'Structure',
  'Panels',
  'Hardware',
  'Trims',
  'Opening',
  'Accessories',
  'Insulation',
  'Concrete',
  'Installation',
  'Shipping',
  'Drawings',
]

const TaxCategoryMappingSchema = new mongoose.Schema(
  {
    backend_category: { type: String, required: true, trim: true, index: true },
    item_type: { type: String, enum: ITEM_TYPES, default: 'PRODUCT' },
    /** Official Avalara tax code — null until approved. Never auto-filled. */
    avalara_tax_code: { type: String, default: null, trim: true },
    description: { type: String, default: '', trim: true },
    /** Match hints used to route invoice lines to this category. */
    keywords: { type: [String], default: [] },
    approval_status: { type: String, enum: APPROVAL_STATUSES, default: 'DRAFT', index: true },
    effective_from: { type: Date, default: null },
    effective_to: { type: Date, default: null },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at: { type: Date, default: null },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

TaxCategoryMappingSchema.index({ backend_category: 1, effective_from: 1 })

/** A mapping is usable for calculation only if APPROVED, has a code, and is in its effective window. */
TaxCategoryMappingSchema.methods.isUsable = function isUsable(at = new Date()) {
  if (this.approval_status !== 'APPROVED') return false
  if (!this.avalara_tax_code) return false
  if (this.effective_from && at < this.effective_from) return false
  if (this.effective_to && at > this.effective_to) return false
  return true
}

module.exports = mongoose.model('TaxCategoryMapping', TaxCategoryMappingSchema)
module.exports.ITEM_TYPES = ITEM_TYPES
module.exports.APPROVAL_STATUSES = APPROVAL_STATUSES
module.exports.BACKEND_CATEGORIES = BACKEND_CATEGORIES
