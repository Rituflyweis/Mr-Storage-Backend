const mongoose = require('mongoose')

const TeamGroupSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    avatar:    { type: String, default: '' },
    members:   { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    admins:    { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive:  { type: Boolean, default: true },
  },
  { timestamps: true }
)

TeamGroupSchema.index({ members: 1 })

module.exports = mongoose.model('TeamGroup', TeamGroupSchema)
