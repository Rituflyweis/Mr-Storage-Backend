const mongoose = require('mongoose')
const { BUILDING_STATUSES, DRAWING_STATUSES } = require('../config/constants')

const DrawingCommentSchema = new mongoose.Schema(
  {
    text:                { type: String, required: true, trim: true },
    commentedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    commentedByCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    authorName:          { type: String, default: '' },
  },
  { timestamps: true }
)

const BuildingSchema = new mongoose.Schema(
  {
    leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    customerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    quotationId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    buildingNumber: { type: Number, required: true },
    status:         { type: String, enum: BUILDING_STATUSES, default: 'pending' },
    drawings: [
      {
        versionNumber:   { type: Number, required: true },
        fileUrl:         { type: String, required: true },
        fileName:        { type: String, required: true },
        status: {
          type: String,
          enum: DRAWING_STATUSES,
          default: 'pending_review',
        },
        rejectionReason: { type: String, default: '' },
        uploadedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        uploadedAt:      { type: Date, default: Date.now },
        reviewedAt:      { type: Date, default: null },
        comments:        { type: [DrawingCommentSchema], default: [] },
      },
    ],
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

BuildingSchema.index({ leadId: 1, buildingNumber: 1 }, { unique: true })
BuildingSchema.index({ leadId: 1 })
BuildingSchema.index({ customerId: 1 })

module.exports = mongoose.model('Building', BuildingSchema)
