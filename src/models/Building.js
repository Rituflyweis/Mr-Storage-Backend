const mongoose = require('mongoose')
const { BUILDING_STATUSES } = require('../config/constants')

const BuildingSchema = new mongoose.Schema(
  {
    leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    quotationId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    buildingNumber: { type: Number, required: true },
    status:         { type: String, enum: BUILDING_STATUSES, default: 'pending' },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

BuildingSchema.index({ leadId: 1, buildingNumber: 1 }, { unique: true })
BuildingSchema.index({ leadId: 1 })
BuildingSchema.index({ customerId: 1 })

module.exports = mongoose.model('Building', BuildingSchema)
