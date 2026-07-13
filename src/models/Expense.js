const mongoose = require('mongoose')

const EXPENSE_CATEGORIES = [
  'materials', 'labour', 'equipment', 'transport',
  'utilities', 'permits', 'subcontractor', 'office',
  'maintenance', 'other',
]

const ExpenseSchema = new mongoose.Schema(
  {
    expenseId:   { type: String, required: true, unique: true, trim: true },
    category:    { type: String, required: true, enum: EXPENSE_CATEGORIES },
    date:        { type: Date, required: true },
    amount:      { type: Number, required: true },
    description: { type: String, default: '', trim: true },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ExpenseSchema.index({ date: -1 })
ExpenseSchema.index({ leadId: 1 })
ExpenseSchema.index({ category: 1 })
ExpenseSchema.index({ isActive: 1 })

module.exports = mongoose.model('Expense', ExpenseSchema)
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES
