const mongoose = require('mongoose')

const ExpenseCategorySchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, unique: true, trim: true },
    isActive:  { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ExpenseCategory', ExpenseCategorySchema)
