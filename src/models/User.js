const mongoose = require('mongoose')
const { USER_ROLES } = require('../config/constants')

const UserSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone:    { type: String, trim: true },
    role:     { type: String, enum: USER_ROLES, required: true },
    isActive:           { type: Boolean, default: true },
    passwordChangedAt:  { type: Date,    default: null },
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
