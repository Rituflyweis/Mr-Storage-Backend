const mongoose = require('mongoose')

const MR_STATUSES = ['pending', 'approved', 'rejected', 'fulfilled', 'cancelled']
const MR_PRIORITIES = ['low', 'medium', 'high', 'critical']

const RequestedItemSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit:     { type: String, default: '', trim: true },
    notes:    { type: String, default: '', trim: true },
    lengthFeet: { type: Number, default: null },
    color:      { type: String, default: '', trim: true },
    deliveryStatus:    { type: String, enum: ['pending', 'delivered'], default: 'pending' },
    deliveryId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', default: null },
    deliveryReference: { type: String, default: '', trim: true },
    deliveredAt:       { type: Date, default: null },
  }
)

const AttachmentSchema = new mongoose.Schema(
  {
    name: { type: String, default: '', trim: true },
    url:  { type: String, required: true, trim: true },
  },
  { _id: false }
)

const MaterialRequestSchema = new mongoose.Schema(
  {
    requestId:    { type: String, unique: true, trim: true },
    leadId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    siteLocation: { type: String, default: '', trim: true },
    buildingLabel: { type: String, default: '', trim: true },
    department:   { type: String, default: '', trim: true },
    source:       { type: String, enum: ['construction', 'customer'], default: 'construction' },
    requestedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    requestedByCustomer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    requestedItems: [RequestedItemSchema],
    attachments:  [AttachmentSchema],
    requestDate:  { type: Date, default: Date.now },
    requiredBy:   { type: Date, default: null },
    preferredDeliveryDate: { type: Date, default: null },
    specialInstructions: { type: String, default: '', trim: true },
    priority:     { type: String, enum: MR_PRIORITIES, default: 'medium' },
    status:       { type: String, enum: MR_STATUSES, default: 'pending' },
    totalAmount:  { type: Number, default: 0 },
    reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:   { type: Date, default: null },
    reviewNotes:  { type: String, default: '', trim: true },
  },
  { timestamps: true }
)

MaterialRequestSchema.index({ leadId: 1, status: 1 })
MaterialRequestSchema.index({ requestedBy: 1 })
MaterialRequestSchema.index({ createdAt: -1 })

module.exports = mongoose.model('MaterialRequest', MaterialRequestSchema)
module.exports.MR_STATUSES = MR_STATUSES
module.exports.MR_PRIORITIES = MR_PRIORITIES
