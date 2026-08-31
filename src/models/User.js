const mongoose = require('mongoose')
const { USER_ROLES } = require('../config/constants')

const UserSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone:    { type: String, trim: true },
    role:       { type: String, enum: USER_ROLES, required: true },
    isMainAdmin:      { type: Boolean, default: false },
    department: { type: String, default: '', trim: true },
    isActive:           { type: Boolean, default: true },
    permissions: {
      leadAccess:       { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      followupsAccess:  { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      reportsAccess:    { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      aiSupportAccess:  { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      settingsAccess:   { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      employees:        { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      taxReport:        { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      insights:         { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      addNewLead:       { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      scheduleMeeting:  { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
      generateReport:   { view: { type: Boolean, default: false }, edit: { type: Boolean, default: false }, delete: { type: Boolean, default: false } },
    },
    passwordChangedAt:  { type: Date,    default: null },
    resetOtp:           { type: String,  default: null },
    resetOtpExpiry:     { type: Date,    default: null },
    resetOtpVerified:   { type: Boolean, default: false },
  },
  { timestamps: true }
)

// Never return password in queries
UserSchema.methods.toJSON = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

module.exports = mongoose.model('User', UserSchema)
