const mongoose = require('mongoose')

// Legacy fixed list — kept only so old records written before ExpenseCategory existed keep working.
// New categories are managed dynamically via the ExpenseCategory collection (see GET/POST /expenses/categories).
const EXPENSE_CATEGORIES = [
  'materials', 'labour', 'equipment', 'transport',
  'utilities', 'permits', 'subcontractor', 'office',
  'maintenance', 'other',
]

const EXPENSE_STATUSES = ['pending', 'approved', 'paid', 'rejected']
const EXPENSE_PAYMENT_METHODS = ['cash', 'bank_transfer', 'credit_card', 'upi', 'cheque', 'other']

const ExpenseSchema = new mongoose.Schema(
  {
    expenseId:     { type: String, required: true, unique: true, trim: true },
    category:      { type: String, required: true, trim: true },
    subcategory:   { type: String, default: '', trim: true },
    date:          { type: Date, required: true },
    amount:        { type: Number, required: true },
    description:   { type: String, default: '', trim: true },
    leadId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    buildingLabel: { type: String, default: '', trim: true },
    paymentMethod: { type: String, enum: EXPENSE_PAYMENT_METHODS, default: null },
    status:        { type: String, enum: EXPENSE_STATUSES, default: 'pending' },
    receiptFile:   { type: String, default: '', trim: true },
    isActive:      { type: Boolean, default: true },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

ExpenseSchema.index({ date: -1 })
ExpenseSchema.index({ leadId: 1 })
ExpenseSchema.index({ category: 1 })
ExpenseSchema.index({ isActive: 1 })
ExpenseSchema.index({ status: 1 })
ExpenseSchema.index({ buildingLabel: 1 })

module.exports = mongoose.model('Expense', ExpenseSchema)
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES
module.exports.EXPENSE_STATUSES = EXPENSE_STATUSES
module.exports.EXPENSE_PAYMENT_METHODS = EXPENSE_PAYMENT_METHODS
