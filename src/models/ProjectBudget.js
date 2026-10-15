const mongoose = require('mongoose')

const CustomBudgetLineSchema = new mongoose.Schema(
  {
    /** Stable client id (uuid/slug) — preserved on updates */
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0 },
    /** Optional Expense.category values that roll into this line's "actual" in budget vs actual */
    expenseCategories: { type: [String], default: [] },
  },
  { _id: false }
)

const ProjectBudgetSchema = new mongoose.Schema(
  {
    leadId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    materialBudget:   { type: Number, default: 0 },
    logisticBudget:   { type: Number, default: 0 },
    productionBudget: { type: Number, default: 0 },
    shipperBudget:    { type: Number, default: 0 },
    otherCost:        { type: Number, default: 0 },
    customLines:      { type: [CustomBudgetLineSchema], default: [] },
    totalBudget:      { type: Number, default: 0 },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ProjectBudget', ProjectBudgetSchema)
module.exports.CustomBudgetLineSchema = CustomBudgetLineSchema
