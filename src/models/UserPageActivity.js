const mongoose = require('mongoose')
const { USER_ROLES } = require('../config/constants')

const PanelVisitSchema = new mongoose.Schema(
  {
    lastVisitedAt: { type: Date, default: null },
    lastPage:      { type: String, default: null },
  },
  { _id: false }
)

const LastPageSchema = new mongoose.Schema(
  {
    panel:     { type: String, enum: USER_ROLES, required: true },
    page:      { type: String, required: true },
    visitedAt: { type: Date, required: true },
  },
  { _id: false }
)

const panelsDefault = () =>
  Object.fromEntries(USER_ROLES.map((role) => [role, {}]))

const UserPageActivitySchema = new mongoose.Schema(
  {
    userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    lastActiveAt: { type: Date, default: null },
    panels:       { type: mongoose.Schema.Types.Mixed, default: panelsDefault },
    lastPage:     { type: LastPageSchema, default: null },
  },
  { timestamps: true }
)

UserPageActivitySchema.index({ lastActiveAt: -1 })

module.exports = mongoose.model('UserPageActivity', UserPageActivitySchema)
