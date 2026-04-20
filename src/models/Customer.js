const mongoose = require('mongoose')
const { LEAD_SOURCES } = require('../config/constants')

const CustomerSchema = new mongoose.Schema(
  {
    customerId:        { type: String, unique: true },
    firstName:         { type: String, required: true, trim: true },
    email:             { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: {
      number:          { type: String, required: true, trim: true },
      countryCode:     { type: String, required: true, trim: true },
    },
    password:          { type: String, required: true },
    passwordChangedAt: { type: Date, default: null },
    photo:             { type: String, default: null },
    isActive:          { type: Boolean, default: true },
    source:            { type: String, enum: LEAD_SOURCES, default: 'chat' },
  },
  { timestamps: true }
)

// email is already indexed via unique:true — only add phone index separately
CustomerSchema.index({ 'phone.number': 1 })

CustomerSchema.methods.toJSON = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

module.exports = mongoose.model('Customer', CustomerSchema)
