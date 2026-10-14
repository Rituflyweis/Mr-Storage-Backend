const mongoose = require('mongoose')

const MISMATCH_ORDER_STATUSES = ['open', 'in_review', 'resolved', 'closed', 'cancelled']

const MismatchLineSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
    partCode: { type: String, default: '' },
    description: { type: String, default: '' },
    expectedQty: { type: Number, default: 0 },
    receivedQty: { type: Number, default: 0 },
    status: { type: String, default: 'Not Received' },
  },
  { _id: false }
)

const PhotoSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    url: { type: String, required: true, trim: true },
  },
  { _id: false }
)

const BundleMismatchOrderSchema = new mongoose.Schema(
  {
    mismatchOrderId: { type: String, unique: true, trim: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    bundleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bundle', required: true, index: true },
    bundleNo: { type: String, default: '' },
    reason: { type: String, default: '', trim: true },
    notes: { type: String, default: '', trim: true },
    items: { type: [MismatchLineSchema], default: [] },
    photos: { type: [PhotoSchema], default: [] },
    status: { type: String, enum: MISMATCH_ORDER_STATUSES, default: 'open', index: true },
    actionNotes: { type: String, default: '', trim: true },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

BundleMismatchOrderSchema.index({ leadId: 1, createdAt: -1 })

module.exports = mongoose.model('BundleMismatchOrder', BundleMismatchOrderSchema)
module.exports.MISMATCH_ORDER_STATUSES = MISMATCH_ORDER_STATUSES
