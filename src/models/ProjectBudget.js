const mongoose = require('mongoose')

const ProjectBudgetSchema = new mongoose.Schema(
  {
    leadId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
    materialBudget:   { type: Number, default: 0 },
    logisticBudget:   { type: Number, default: 0 },
    productionBudget: { type: Number, default: 0 },
    shipperBudget:    { type: Number, default: 0 },
    otherCost:        { type: Number, default: 0 },
    totalBudget:      { type: Number, default: 0 },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ProjectBudget', ProjectBudgetSchema)
