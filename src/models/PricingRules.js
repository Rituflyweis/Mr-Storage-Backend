const mongoose = require('mongoose')

const CostSellSchema = new mongoose.Schema(
  { cost: { type: Number, default: 0 }, sell: { type: Number, default: 0 } },
  { _id: false }
)

const CustomTabRuleSchema = new mongoose.Schema(
  {
    // Legacy fields (admin API)
    matchAgainst: { type: String, enum: ['Part #', 'Description', 'Tab Name'], default: 'Part #' },
    valueToMatch: { type: String, default: '' },
    category:     { type: String, default: '' },
    pricingMethod: { type: String, enum: ['per_lb', 'per_sf', 'per_lf', 'flat', 'flat_each', 'flat_total'], default: 'per_lb' },
    rate:         { type: Number, default: 0 },
    label:        { type: String, default: '' },
    // HTML quoting tool fields
    matchType:    { type: String, enum: ['tab_name', 'part_number', 'description'], default: 'part_number' },
    match:        { type: String, default: '' },
    cat:          { type: String, default: 'trim' },
    method:       { type: String, enum: ['per_lb', 'per_sf', 'per_lf', 'flat_each', 'flat_total'], default: 'per_lb' },
    note:         { type: String, default: '' },
  },
  { _id: true }
)

// One document per sales user — "Your numbers, edit and save" (Figma: Pricing Rules screen).
const PricingRulesSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    steelRatesPerLb: {
      primaryFrames:  { type: Number, default: 1.71 },
      secondarySteel: { type: Number, default: 0.88 },
      hssBeams:       { type: Number, default: 0.88 },
      angles:         { type: Number, default: 1.04 },
      openingsJambs:  { type: Number, default: 1.2 },
      platesClips:    { type: Number, default: 1.2 },
    },

    sheetingRatesPerSf: {
      standardScrewDown: { type: Number, default: 1.71 },
      standingSeam:      { type: Number, default: 1.04 },
    },

    freight: {
      ratePerLb:                { type: Number, default: 1.71 },
      lbsPerTruck:               { type: Number, default: 40000 },
      accessoriesAllowancePerSf: { type: Number, default: 0.1 },
      vendorDeltaPerLb:          { type: Number, default: 0.1 },
    },

    install: {
      pembEasy:         { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
      pembMedium:        { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
      pembHard:          { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
      pembTallHard:      { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
      storageBasic:      { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
      storageTall:       { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
      storageOverhang:   { type: CostSellSchema, default: () => ({ cost: 5.5, sell: 8.5 }) },
    },

    markup: {
      pembMultiplier:    { type: Number, default: 1.3 },  // e.g. 1.30 = cost x 1.30 (30%)
      storageMultiplier: { type: Number, default: 1.18 },
    },

    customTabRules: { type: [CustomTabRuleSchema], default: [] },
  },
  { timestamps: true }
)

module.exports = mongoose.model('PricingRules', PricingRulesSchema)
