const mongoose = require('mongoose')

const FollowUpTemplateSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    category: { type: String, default: 'general', trim: true, maxlength: 40 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

FollowUpTemplateSchema.index({ isDeleted: 1, isActive: 1, sortOrder: 1, createdAt: -1 })
FollowUpTemplateSchema.index({ title: 1 })
FollowUpTemplateSchema.index({ category: 1 })

module.exports = mongoose.model('FollowUpTemplate', FollowUpTemplateSchema)
